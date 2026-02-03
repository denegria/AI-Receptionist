import { Router, Request, Response } from 'express';
import { BillingService } from '../../services/billing';
import { ProvisioningService } from '../../services/provisioning';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { logger } from '../../utils/logger';
import { ClientConfig } from '../../models/client-config';

export const onboardingRouter = Router();

/**
 * GET /api/onboarding/search-numbers
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
 * POST /api/onboarding/setup-intent
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
 * POST /api/onboarding/provision
 */
onboardingRouter.post('/provision', async (req: Request, res: Response) => {
  const { clientId, businessName, timezone, phoneNumber, plan } = req.body;

  try {
    // 1. Buy the Twilio number
    await ProvisioningService.buyNumber(phoneNumber, clientId);

    // 2. Initialize the client's database
    await ProvisioningService.initializeClientDatabase(clientId);

    // 3. Register the client in the shared registry
    const config: ClientConfig = {
      clientId,
      businessName,
      phoneNumber,
      timezone: timezone || 'America/New_York',
      businessHours: {
        monday: { start: '09:00', end: '17:00', enabled: true },
        tuesday: { start: '09:00', end: '17:00', enabled: true },
        wednesday: { start: '09:00', end: '17:00', enabled: true },
        thursday: { start: '09:00', end: '17:00', enabled: true },
        friday: { start: '09:00', end: '17:00', enabled: true },
        saturday: { start: '09:00', end: '12:00', enabled: false },
        sunday: { start: '09:00', end: '12:00', enabled: false },
      },
      holidays: [],
      appointmentTypes: [
        { name: 'General Inquiry', duration: 30, bufferBefore: 0, bufferAfter: 0 }
      ],
      calendar: {
        provider: 'google',
        calendarId: 'primary',
        syncEnabled: false,
        createMeetLinks: false,
      },
      routing: {
        afterHoursAction: 'voicemail',
        fallbackNumber: '',
        voicemailEnabled: true,
      },
      notifications: {
        sms: '',
        email: '',
      },
      aiSettings: {
        greeting: `Hi, thank you for calling ${businessName}. How can I help you today?`,
        maxRetries: 3,
        requireServiceType: false,
      }
    };

    clientRegistryRepository.register(config);
    
    // Ensure status is set to trial
    clientRegistryRepository.updateStatus(clientId, 'trial');

    res.json({ success: true, clientId });
  } catch (error: any) {
    logger.error('Onboarding Provisioning error', { error: error.message, clientId });
    res.status(500).json({ error: 'Failed to provision account' });
  }
});
