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
}
