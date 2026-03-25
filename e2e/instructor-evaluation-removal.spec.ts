import { test, expect, Page } from '@playwright/test';

async function drawSignatureOnCanvas(page: Page) {
  const canvas = page.locator('[role="dialog"] canvas').first();
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await canvas.waitFor({ state: 'visible', timeout: 5000 });

  const box = await canvas.boundingBox();
  if (!box) throw new Error('Canvas bounding box not found');

  await page.evaluate((canvasBox) => {
    const canvasEl = document.querySelector('[role="dialog"] canvas') as HTMLCanvasElement;
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();

    const points: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      points.push({
        x: rect.left + 20 + (rect.width - 40) * t,
        y: rect.top + rect.height / 2 + Math.sin(t * Math.PI * 4) * 15,
      });
    }

    const mousedown = new MouseEvent('mousedown', {
      clientX: points[0].x,
      clientY: points[0].y,
      bubbles: true,
    });
    canvasEl.dispatchEvent(mousedown);

    for (let i = 1; i < points.length; i++) {
      const mousemove = new MouseEvent('mousemove', {
        clientX: points[i].x,
        clientY: points[i].y,
        bubbles: true,
      });
      canvasEl.dispatchEvent(mousemove);
    }

    const mouseup = new MouseEvent('mouseup', {
      clientX: points[points.length - 1].x,
      clientY: points[points.length - 1].y,
      bubbles: true,
    });
    canvasEl.dispatchEvent(mouseup);
  }, box);

  await page.waitForTimeout(300);
}

function getStudentNameFromRow(row: string): string {
  return row.trim();
}

test.describe('Instructor Evaluations - Correct Student Removal After Evaluation', () => {
  test('only the evaluated student (A) is removed; other student (B) remains after page refresh', async ({ page }) => {
    test.setTimeout(120000);

    // ── Step 1: Login as instructor ──
    await page.goto('/instructor/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[type="email"], input[name="email"]').fill('demo.instructor@example.com');
    await page.locator('input[type="password"], input[name="password"]').fill('instructor123');
    await page.locator('button[type="submit"]').click();
    await page.waitForURL('**/instructor/schedule', { timeout: 15000 });

    // ── Step 2: Navigate to Evaluations page ──
    await page.goto('/instructor/evaluations');
    await page.waitForLoadState('networkidle');

    const tableBody = page.locator('table tbody');
    await tableBody.waitFor({ state: 'visible', timeout: 10000 });

    // ── Setup: Ensure at least two students are visible ──
    const studentRows = tableBody.locator('tr');
    await studentRows.first().waitFor({ state: 'visible', timeout: 5000 });
    const initialCount = await studentRows.count();

    if (initialCount < 2) {
      test.skip(true, 'Need at least 2 pending evaluations to run this test');
      return;
    }

    // Capture Student A (first row) and Student B (second row)
    const studentAName = getStudentNameFromRow(
      (await studentRows.nth(0).locator('td').first().textContent()) || ''
    );
    const studentBName = getStudentNameFromRow(
      (await studentRows.nth(1).locator('td').first().textContent()) || ''
    );

    expect(studentAName.length).toBeGreaterThan(0);
    expect(studentBName.length).toBeGreaterThan(0);
    expect(studentAName).not.toEqual(studentBName);

    console.log(`Student A (to evaluate): "${studentAName}"`);
    console.log(`Student B (should remain): "${studentBName}"`);
    console.log(`Initial pending count: ${initialCount}`);

    // ── Action: Perform a full evaluation for Student A ──
    await studentRows.nth(0).locator('button:has-text("Evaluate")').click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in form fields
    const strengthsField = dialog.locator('textarea[name="strengths"]');
    if (await strengthsField.count() > 0 && await strengthsField.isVisible()) {
      await strengthsField.fill('Good lane positioning and smooth turns');
    }

    const weaknessesField = dialog.locator('textarea[name="weaknesses"]');
    if (await weaknessesField.count() > 0 && await weaknessesField.isVisible()) {
      await weaknessesField.fill('Needs work on parallel parking');
    }

    const notesField = dialog.locator('textarea[name="notes"]');
    if (await notesField.count() > 0 && await notesField.isVisible()) {
      await notesField.fill('Overall good progress');
    }

    // Click "Proceed to Signatures"
    const submitBtn = dialog.locator('button[type="submit"]');
    await submitBtn.scrollIntoViewIfNeeded();
    await submitBtn.click();

    // Instructor Signature
    await page.waitForTimeout(1000);
    await dialog.locator('text=Instructor Signature').first().waitFor({ state: 'visible', timeout: 8000 });
    await drawSignatureOnCanvas(page);
    const confirmInstructorBtn = dialog.locator('button:has-text("Confirm Instructor Signature")');
    await confirmInstructorBtn.scrollIntoViewIfNeeded();
    await confirmInstructorBtn.click();

    // Student Signature
    await page.waitForTimeout(1000);
    await dialog.locator('text=For the Student').waitFor({ state: 'visible', timeout: 10000 });
    await drawSignatureOnCanvas(page);
    const confirmStudentBtn = dialog.locator('button:has-text("Confirm Student Signature")');
    await confirmStudentBtn.scrollIntoViewIfNeeded();
    await confirmStudentBtn.click();

    // Ready to Submit
    await page.waitForTimeout(500);
    await dialog.locator('text=Ready to Submit').waitFor({ state: 'visible', timeout: 10000 });

    // ── Wait: Set up API response listener, then click "Create Evaluation" ──
    const apiResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/instructor/evaluations') &&
        response.request().method() === 'POST',
      { timeout: 15000 }
    );

    const createButton = dialog.locator('button:has-text("Create Evaluation")');
    await createButton.scrollIntoViewIfNeeded();
    await createButton.click();

    // Wait for API success confirmation
    const apiResponse = await apiResponsePromise;
    expect([200, 201]).toContain(apiResponse.status());

    // Wait for dialog to close (success confirmation)
    await expect(dialog).toBeHidden({ timeout: 10000 });

    // ── Refresh: Perform a full page refresh (matches reported issue steps) ──
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');

    // Wait for the evaluations table to reload with data
    await tableBody.waitFor({ state: 'visible', timeout: 15000 });
    const updatedRows = tableBody.locator('tr');
    await updatedRows.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
      // Table might have fewer rows now — handled in assertions below
    });
    await page.waitForTimeout(500);

    const updatedCount = await updatedRows.count();

    // Collect all remaining student names (exact text, trimmed)
    const remainingNames: string[] = [];
    for (let i = 0; i < updatedCount; i++) {
      const name = getStudentNameFromRow(
        (await updatedRows.nth(i).locator('td').first().textContent()) || ''
      );
      if (name) remainingNames.push(name);
    }

    console.log(`Remaining students after refresh: [${remainingNames.join(', ')}]`);
    console.log(`Updated count: ${updatedCount}`);

    // ── Assertion 1: Student A is no longer in the list ──
    const studentAStillPresent = remainingNames.some((name) => name === studentAName);
    expect(studentAStillPresent, `Student A ("${studentAName}") should NOT be in the list after evaluation`).toBe(false);

    // ── Assertion 2 (The Fix): Student B is STILL present in the list ──
    const studentBStillPresent = remainingNames.some((name) => name === studentBName);
    expect(studentBStillPresent, `Student B ("${studentBName}") MUST still be in the list`).toBe(true);

    // ── Assertion 3: Total count decreased by exactly one, not two ──
    expect(updatedCount, `Count should decrease by exactly 1 (from ${initialCount} to ${initialCount - 1})`).toBe(initialCount - 1);
  });
});
