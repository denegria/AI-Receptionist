import Stripe from 'stripe';
import { sharedDb } from '../db/shared-client';
import { logger } from '../utils/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

sharedDb.exec(`
  CREATE TABLE IF NOT EXISTS billing_customers (
    client_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    email TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

function saveCustomerMapping(clientId: string, customerId: string, email?: string | null) {
  const stmt = sharedDb.prepare(`
    INSERT INTO billing_customers (client_id, customer_id, email, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(client_id) DO UPDATE SET
      customer_id = excluded.customer_id,
      email = excluded.email,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(clientId, customerId, email || null);
}

function getMappedCustomerId(clientId: string): string | null {
  const row = sharedDb.prepare(`SELECT customer_id FROM billing_customers WHERE client_id = ?`).get(clientId) as { customer_id?: string } | undefined;
  return row?.customer_id || null;
}

export class BillingService {
  /**
   * Creates a Stripe Customer for a business
   */
  static async createCustomer(email: string, businessName: string, clientId: string) {
    try {
      const customer = await stripe.customers.create({
        email,
        name: businessName,
        metadata: {
          clientId,
        },
      });
      saveCustomerMapping(clientId, customer.id, email);
      return customer;
    } catch (error) {
      logger.error('Error creating Stripe customer', { error, email, clientId });
      throw error;
    }
  }

  /**
   * Creates a SetupIntent to collect payment method for future use (14-day trial logic)
   * This does NOT charge the card.
   */
  static async createSetupIntent(customerId: string) {
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session',
      });
      return setupIntent;
    } catch (error) {
      logger.error('Error creating Stripe SetupIntent', { error, customerId });
      throw error;
    }
  }

  /**
   * Retrieves a customer by email or creates one if it doesn't exist
   */
  static async getOrCreateCustomer(email: string, businessName: string, clientId: string) {
    try {
      const existingCustomers = await stripe.customers.list({ email, limit: 1 });
      if (existingCustomers.data.length > 0) {
        const existing = existingCustomers.data[0];
        if (existing.metadata?.clientId !== clientId) {
          const updated = await stripe.customers.update(existing.id, {
            name: existing.name || businessName,
            metadata: { ...(existing.metadata || {}), clientId },
          });
          saveCustomerMapping(clientId, updated.id, updated.email || email);
          return updated;
        }
        saveCustomerMapping(clientId, existing.id, existing.email || email);
        return existing;
      }
      return await this.createCustomer(email, businessName, clientId);
    } catch (error) {
      logger.error('Error in getOrCreateCustomer', { error, email });
      throw error;
    }
  }

  /**
   * Creates a Stripe Checkout Session for subscription
   */
  static async createCheckoutSession(customerId: string, priceId: string, successUrl: string, cancelUrl: string, clientId: string) {
    try {
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          trial_period_days: 14,
          metadata: {
            clientId,
          },
        },
        metadata: {
          clientId,
        },
      });
      return session;
    } catch (error) {
      logger.error('Error creating Stripe Checkout Session', { error, customerId, clientId });
      throw error;
    }
  }

  static async findCustomerByClientId(clientId: string) {
    const mappedId = getMappedCustomerId(clientId);
    if (mappedId) {
      try {
        const mapped = await stripe.customers.retrieve(mappedId);
        if (!('deleted' in mapped && mapped.deleted)) {
          return mapped as Stripe.Customer;
        }
      } catch {
        // fallback to metadata scan
      }
    }

    const customers = stripe.customers.list({ limit: 100 });
    for await (const customer of customers) {
      if (customer.metadata?.clientId === clientId) {
        saveCustomerMapping(clientId, customer.id, customer.email || null);
        return customer;
      }
    }
    return null;
  }

  static async hasSavedPaymentMethod(clientId: string): Promise<boolean> {
    const customer = await this.findCustomerByClientId(clientId);
    if (!customer?.id) return false;

    const pms = await stripe.paymentMethods.list({ customer: customer.id, type: 'card', limit: 1 });
    return pms.data.length > 0;
  }

  /**
   * Verify a Stripe Webhook signature
   */
  static constructEvent(payload: string, signature: string, secret: string) {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  }
}
