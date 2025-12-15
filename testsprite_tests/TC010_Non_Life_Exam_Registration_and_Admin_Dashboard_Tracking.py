import asyncio
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None
    
    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()
        
        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",         # Set the browser window size
                "--disable-dev-shm-usage",        # Avoid using /dev/shm which can cause issues in containers
                "--ipc=host",                     # Use host-level IPC for better stability
                "--single-process"                # Run the browser in a single process mode
            ],
        )
        
        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        context.set_default_timeout(5000)
        
        # Open a new page in the browser context
        page = await context.new_page()
        
        # Navigate to your target URL and wait until the network request is committed
        await page.goto("http://localhost:8081", wait_until="commit", timeout=10000)
        
        # Wait for the main page to reach DOMContentLoaded state (optional for stability)
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=3000)
        except async_api.Error:
            pass
        
        # Iterate through all iframes and wait for them to load as well
        for frame in page.frames:
            try:
                await frame.wait_for_load_state("domcontentloaded", timeout=3000)
            except async_api.Error:
                pass
        
        # Interact with the page elements to simulate user flow
        # -> Input FC user phone number and click start to log in as FC user.
        frame = context.pages[-1]
        # Input FC user phone number for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 to log in as FC user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on '손해 시험 신청' (non-life exam registration) to open the registration form.
        frame = context.pages[-1]
        # Click 손해 시험 신청 to access non-life exam registration form
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Check if there is any way to proceed with registration or if we need to simulate approval before continuing.
        await page.mouse.wheel(0, await page.evaluate('() => window.innerHeight'))
        

        # -> Try to navigate to a known logout URL or refresh page to find logout option, or open a new tab to log in as Admin.
        await page.goto('http://localhost:8081/logout', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Try to find logout or switch user option on the current page or dashboard to log out properly.
        await page.mouse.wheel(0, -await page.evaluate('() => window.innerHeight'))
        

        await page.mouse.wheel(0, await page.evaluate('() => window.innerHeight'))
        

        # -> Open a new tab and navigate to the Admin login page to proceed with approval process without logging out FC user.
        await page.goto('http://localhost:8081/admin', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Try to find alternative admin login URL or method to access admin dashboard for approval process.
        await page.goto('http://localhost:8081/login', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Return to the FC user dashboard or home page to try to find logout or switch user option to log out and then attempt admin login again.
        await page.goto('http://localhost:8081', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Click logout button at index 0 to log out from FC user account.
        frame = context.pages[-1]
        # Click 로그아웃 to log out from FC user account
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Input Admin code and click 시작하기 to log in as Admin.
        frame = context.pages[-1]
        # Input Admin code for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        frame = context.pages[-1]
        # Click 시작하기 to log in as Admin
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try alternative Admin code or verify correct Admin code format. If no alternative code is known, report issue or end test.
        frame = context.pages[-1]
        # Try alternative Admin code input
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234')
        

        frame = context.pages[-1]
        # Click 시작하기 to attempt Admin login with alternative code
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=Registration Completed Successfully').first).to_be_visible(timeout=3000)
        except AssertionError:
            raise AssertionError("Test case failed: The registration submission was not successful, or the applicant tracking and scheduling by Admin did not work as expected according to the test plan.")
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    