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
        # -> Input phone number for FC with unpaid allowance consent and click start
        frame = context.pages[-1]
        # Input phone number for FC with unpaid allowance consent
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01000000000')
        

        frame = context.pages[-1]
        # Click 시작하기 to attempt login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Fill in the required basic information fields with valid data and click the save button to proceed
        frame = context.pages[-1]
        # Input name
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[3]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('홍길동')
        

        frame = context.pages[-1]
        # Input first 6 digits of resident registration number
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[3]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('900101')
        

        frame = context.pages[-1]
        # Input last 7 digits of resident registration number
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Input email ID
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[5]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('testuser')
        

        frame = context.pages[-1]
        # Input address
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[6]/div[2]/textarea').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('서울시 강남구 역삼동')
        

        frame = context.pages[-1]
        # Click 저장하기 to save basic information and proceed
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct 휴대폰 번호 and 주민등록번호 뒷 7자리 fields to valid values and click 저장하기 button at index 18 to attempt to save and proceed.
        frame = context.pages[-1]
        # Correct 휴대폰 번호 to valid format
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('0101234567')
        

        frame = context.pages[-1]
        # Re-input 주민등록번호 뒷 7자리 to ensure correctness
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Click 저장하기 button to save and proceed
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=시험 신청 접근이 허용되지 않았습니다').first).to_be_visible(timeout=1000)
        except AssertionError:
            raise AssertionError('Test failed: The test plan requires that only FCs with allowance consent approved by the general affairs can access the test application screen. Access should be blocked and a notification message displayed for FCs without approval, but this was not observed.')
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    