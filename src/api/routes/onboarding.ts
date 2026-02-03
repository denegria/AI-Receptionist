import { Router, Request, Response } from 'express';
import { BillingService } from '../../services/billing';
import { ProvisioningService } from '../../services/provisioning';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { logger } from '../../utils/logger';
import { ClientConfig } from '../../models/client-config';

export const onboardingRouter = Router();

/**
 * Step 1: Create a SetupIntent to collect payment method
 * This happens after plan selection.
 */
onboardingRouter.post('/setup-intent', async (req: Request, res: Response) => {
  const { email, businessName, clientId } = req.body;

  try {
    const customer = await BillingService.getOrCreateCustomer(email, businessName, clientId);
    const setupIntent = await BillingService.createSetupIntent(customer.id);

    res.json({
      clientSecret: setupIntent.client_secret,
      customerId: customer.id,
    });
  } catch (error: any) {
    logger.error('Onboarding SetupIntent error', { error: error.message, email });
    res.status(500).json({ error: 'Failed to initialize payment setup' });
  }
});

/**
 * Step 2: Search for available phone numbers
 */
onboardingRouter.get('/search-numbers', async (req: Request, res: Response) => {
  const { areaCode } = req.query;

  try {
    const numbers = await ProvisioningService.searchNumbers(areaCode as string);
    res.json({ numbers });
  } catch (error: any) {
    logger.error('Onboarding Search Numbers error', { error: error.message });
    res.status(500).json({ error: 'Failed to search for numbers' });
  }
});

/**
 * Step 3: Provision the number and initialize the client
 * This happens after number selection.
 */
onboardingRouter.post('/provision', async (req: Request, res: Response) => {
  const { clientId, businessName, timezone, phoneNumber, plan } = req.body;

  try {
    // 1. Buy the Twilio number
    await ProvisioningService.buyNumber(phoneNumber, clientId);

    // 2. Initialize the client's database (Authorized Disk Bomb bypass)
    await ProvisioningService.initializeClientDatabase(clientId);

    // 3. Register the client in the shared registry
    const config: ClientConfig = {
      clientId,
      businessName,
      phoneNumber,
      timezone: timezone || 'America/New_York',
      // Default configurations
      ai: {
        provider: 'claude',
        model: 'claude-3-5-sonnet-20240620',
        voice: 'en-US-Standard-C',
      },
      scheduling: {
        enabled: false,
        provider: 'google',
      },
      notifications: {
        sms: '',
        email: '',
      },
      features: {
        voicemail: true,
        transcription: true,
      }
    };

    clientRegistryRepository.register(config);
    
    // Update status to trial as per directive
    clientRegistryRepository.updateStatus(clientId, 'trial');

    res.json({ success: true, clientId });
  } catch (error: any) {
    logger.error('Onboarding Provisioning error', { error: error.message, clientId });
    res.status(500).json({ error: 'Failed to provision account' });
  }
});
