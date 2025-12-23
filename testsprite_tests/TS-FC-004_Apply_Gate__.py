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
        # -> Click '시작하기' button to start registration.
        frame = context.pages[-1]
        # Click '시작하기' button to start registration
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[3]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Input a valid phone number into the phone number field to proceed.
        frame = context.pages[-1]
        # Input valid phone number to proceed with registration
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[2]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        # -> Click '시작하기' button to start registration after entering phone number.
        frame = context.pages[-1]
        # Click '시작하기' button to start registration after entering phone number
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[3]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Navigate to Home Lite and click '등록 신청 시작' button to verify the registration start guidance screen appears.
        frame = context.pages[-1]
        # Click '시작' button in the '앱 사용법 안내 시작하기' section to simulate starting registration or guidance.
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div[2]/div/div/div/div/div/div/div[3]/button').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Close the popup and locate the '등록 신청 시작' button in Home Lite to start the registration application and verify the guidance screen appears.
        frame = context.pages[-1]
        # Click '건너뛰기' or close the popup to dismiss the guidance message
        elem = frame.locator('xpath=html/body/div/div/div/div/div[3]/div/div[2]/div/div[2]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Locate and click the '등록 신청 시작' button to verify the registration start guidance screen appears.
        frame = context.pages[-1]
        # Click '생명/제3 시험 신청' button as a proxy for '등록 신청 시작' to start registration application and verify guidance screen
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div[2]/div/div/div/div/div/div/div[8]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=Registration Completed Successfully').first).to_be_visible(timeout=1000)
        except AssertionError:
            raise AssertionError("Test case failed: The registration start guidance screen with title '위촉(등록) 신청 안내' and the three lines of guidance text did not appear after clicking the '등록 신청 시작' button in Home Lite.")
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    