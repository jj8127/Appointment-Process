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
        # -> Input FC user phone number and click start to log in.
        frame = context.pages[-1]
        # Input FC user phone number for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 (Start) button to log in as FC user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on '생명/제3 시험 신청' (Life/3rd Exam Application) to open the life exam registration form.
        frame = context.pages[-1]
        # Click 생명/제3 시험 신청 to open life exam registration form
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div[2]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Check if there is any way to proceed with the registration or if the user must wait for consent approval.
        frame = context.pages[-1]
        # Click the message or any interactive element to check for more info or options to proceed
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Navigate to the root URL or login page to log out and log in as admin to continue testing.
        await page.goto('http://localhost:8081', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Click the logout button to log out the FC user.
        frame = context.pages[-1]
        # Click 로그아웃 (Logout) button to log out FC user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Input admin code and click 시작하기 (Start) to log in as admin.
        frame = context.pages[-1]
        # Input admin code for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('admin1234')
        

        frame = context.pages[-1]
        # Click 시작하기 (Start) button to log in as admin
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=Registration Completed Successfully').first).to_be_visible(timeout=30000)
        except AssertionError:
            raise AssertionError("Test case failed: The life exam registration process did not complete successfully as expected. The confirmation message 'Registration Completed Successfully' was not found on the page, indicating the registration or admin monitoring steps failed.")
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    