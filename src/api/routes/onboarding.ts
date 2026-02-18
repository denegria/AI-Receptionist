import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { BillingService } from '../../services/billing';
import { ProvisioningService } from '../../services/provisioning';
import { clientRegistryRepository } from '../../db/repositories/client-registry-repository';
import { logger } from '../../utils/logger';
import { ClientConfig } from '../../models/client-config';
import { config as appConfig } from '../../config';

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
 * POST /api/onboarding/checkout-session
 */
onboardingRouter.post('/checkout-session', async (req: Request, res: Response) => {
  const { email, businessName, clientId, priceId, successUrl, cancelUrl } = req.body;

  try {
    const customer = await BillingService.getOrCreateCustomer(email, businessName, clientId);
    const session = await BillingService.createCheckoutSession(
      customer.id, 
      priceId, 
      successUrl, 
      cancelUrl, 
      clientId
    );

    res.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: any) {
    logger.error('Onboarding Checkout Session error', { error: error.message, email });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/**
 * POST /api/onboarding/provision
 */
onboardingRouter.post('/provision', async (req: Request, res: Response) => {
  const { clientId, businessName, timezone, phoneNumber, plan, onboardingConfig } = req.body;

  try {
    // 1. Buy the Twilio number
    await ProvisioningService.buyNumber(phoneNumber, clientId);

    // 2. Initialize the client's database
    await ProvisioningService.initializeClientDatabase(clientId);

    const fallbackBusinessHours = {
      monday: { start: '09:00', end: '17:00', enabled: true },
      tuesday: { start: '09:00', end: '17:00', enabled: true },
      wednesday: { start: '09:00', end: '17:00', enabled: true },
      thursday: { start: '09:00', end: '17:00', enabled: true },
      friday: { start: '09:00', end: '17:00', enabled: true },
      saturday: { start: '09:00', end: '12:00', enabled: false },
      sunday: { start: '09:00', end: '12:00', enabled: false },
    };

    const config: ClientConfig = {
      clientId,
      businessName,
      phoneNumber,
      timezone: timezone || onboardingConfig?.timezone || 'America/New_York',
      businessHours: onboardingConfig?.businessHours || fallbackBusinessHours,
      holidays: onboardingConfig?.holidays || [],
      appointmentTypes: onboardingConfig?.appointmentTypes?.length
        ? onboardingConfig.appointmentTypes
        : [{ name: 'General Inquiry', duration: 30, bufferBefore: 0, bufferAfter: 0 }],
      calendar: {
        provider: onboardingConfig?.calendar?.provider === 'outlook' ? 'outlook' : 'google',
        calendarId: onboardingConfig?.calendar?.calendarId || 'primary',
        syncEnabled: Boolean(onboardingConfig?.calendar?.syncEnabled),
        createMeetLinks: Boolean(onboardingConfig?.calendar?.createMeetLinks),
      },
      routing: {
        afterHoursAction:
          onboardingConfig?.routing?.afterHoursAction === 'forward'
            ? 'forward'
            : onboardingConfig?.routing?.afterHoursAction === 'ai_receptionist'
            ? 'ai_receptionist'
            : 'voicemail',
        fallbackNumber: onboardingConfig?.routing?.fallbackNumber || '',
        voicemailEnabled: onboardingConfig?.routing?.voicemailEnabled ?? true,
      },
      notifications: {
        sms: onboardingConfig?.notifications?.sms || '',
        email: onboardingConfig?.notifications?.email || '',
      },
      aiSettings: {
        greeting:
          onboardingConfig?.aiSettings?.greeting ||
          `Hi, thank you for calling ${businessName}. How can I help you today?`,
        maxRetries: Number.isFinite(onboardingConfig?.aiSettings?.maxRetries)
          ? Number(onboardingConfig.aiSettings.maxRetries)
          : 3,
        requireServiceType: Boolean(onboardingConfig?.aiSettings?.requireServiceType),
      }
    };

    // 3. Generate client config file for watcher/ops visibility
    const onboardingDir = appConfig.paths.onboarding;
    if (!fs.existsSync(onboardingDir)) {
      fs.mkdirSync(onboardingDir, { recursive: true });
    }
    const configFilePath = path.join(onboardingDir, `${clientId}.json`);
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf-8');

    // 4. Register immediately in shared registry (no watcher lag)
    const existing = clientRegistryRepository.findById(clientId);
    if (existing) {
      clientRegistryRepository.updateConfig(clientId, config);
    } else {
      clientRegistryRepository.register(config);
    }

    // Ensure status is set to trial
    clientRegistryRepository.updateStatus(clientId, 'trial');

    res.json({ success: true, clientId, configFilePath, plan: plan || null });
  } catch (error: any) {
    logger.error('Onboarding Provisioning error', { error: error.message, clientId });
    res.status(500).json({ error: 'Failed to provision account' });
  }
});
