import { test, expect } from '@playwright/test';

test.describe('AI Contact Center End-to-End Browser Suite', () => {
  test('renders login console with Passkey option and 14-day self-serve trial link', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Contact Center Console' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign In with Passkey/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Start 14-day Pro Workspace Trial/i })).toBeVisible();
  });

  test('completes self-serve workspace signup and enters 60-second onboarding wizard', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: /Launch Your AI Contact Center/i })).toBeVisible();

    const uniqueSuffix = Date.now();
    await page.getByLabel('Organization Name').fill(`Apex Climate ${uniqueSuffix}`);
    await page.getByLabel('Your Full Name').fill('Taylor Morgan');
    await page.getByLabel('Work Email').fill(`taylor.${uniqueSuffix}@apex-climate.example.com`);
    await page.getByLabel(/Password/i).fill('StrongPass123!');
    await page.getByRole('button', { name: /Create Workspace & Start Onboarding/i }).click();

    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByRole('heading', { name: /Welcome to Your Autonomous AI Contact Center/i })).toBeVisible();
  });

  test('renders standalone Web Chat & Click-to-Call Voice customizer and serves /api/v1/widget.js', async ({
    page,
    request,
  }) => {
    const sdkRes = await request.get('http://localhost:3001/api/v1/widget.js');
    expect(sdkRes.ok()).toBeTruthy();
    const sdkSource = await sdkRes.text();
    expect(sdkSource).toContain('__CS_AI_WIDGET_LOADED__');

    await page.goto('/chat-widget');
    await expect(page.getByText('Visual Widget Customizer & Embed Code')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Click-to-Call' })).toBeVisible();
  });
});
