import Stripe from 'stripe';
import { logger } from '../utils/logger';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-02-11.acacia' as any,
});

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
        return existingCustomers.data[0];
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
    const page = await stripe.customers.list({ limit: 100 });
    return page.data.find((c) => c.metadata?.clientId === clientId) || null;
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
