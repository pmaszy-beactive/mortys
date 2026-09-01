import { expect, test } from "@playwright/test";

test("course selection goes directly to email without an early date step", async ({ page }) => {
  let startDateRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/course-start-dates") {
      startDateRequests += 1;
    }
  });

  await page.goto("/student/register");
  await expect(page.getByText("Choose a Start Date")).toHaveCount(0);

  await page.getByTestId("card-course-type-auto").click();

  await expect(page.getByRole("heading", { name: "Create Your Account" })).toBeVisible();
  await expect(page.getByTestId("input-email")).toBeVisible();
  await expect(page.getByText("Choose a Start Date")).toHaveCount(0);
  expect(startDateRequests).toBe(0);

  await page.getByTestId("button-back-to-course-type").click();
  await expect(page.getByTestId("card-course-type-auto")).toBeVisible();
});