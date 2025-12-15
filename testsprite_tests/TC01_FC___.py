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
        # -> Input FC phone number 01012345678 and click 시작하기 (start) button.
        frame = context.pages[-1]
        # Input FC phone number 01012345678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 (start) button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click '기본 정보 인적사항 수정' to open the basic information input screen.
        frame = context.pages[-1]
        # Click '기본 정보 인적사항 수정' to open basic info input screen
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Fill required fields with correct format: name, phone 01012345678, resident number 9001011234567, address, then click 저장하기 (save) button.
        frame = context.pages[-1]
        # Input name 홍길동
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[3]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('홍길동')
        

        frame = context.pages[-1]
        # Input phone number 01012345678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Input resident number front 6 digits 900101
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[3]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('900101')
        

        frame = context.pages[-1]
        # Input resident number back 7 digits 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Input address 서울특별시 강남구 테헤란로 123
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[6]/div[2]/textarea').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('서울특별시 강남구 테헤란로 123')
        

        frame = context.pages[-1]
        # Click 저장하기 (save) button to save the basic info
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Refresh the page to simulate app restart and verify if saved personal info is retained.
        frame = context.pages[-1]
        # Click refresh button to reload the page and simulate app restart
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div/div[2]/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Navigate to '기본 정보 인적사항 수정' to verify if saved personal info is retained in the input fields.
        frame = context.pages[-1]
        # Click '기본 정보 인적사항 수정' to open basic info input screen and verify saved data
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct the phone number and resident registration number fields to proper format (e.g., 01012345678 for phone, 900101 and 1234567 for resident number) and save again to ensure all required fields are properly saved.
        frame = context.pages[-1]
        # Correct phone number to 01012345678 without dashes
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Correct resident registration number front 6 digits to 900101
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[4]/div[3]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('900101')
        

        frame = context.pages[-1]
        # Correct resident registration number back 7 digits to 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Click 저장하기 (save) button to save corrected info
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=홍길동님 환영합니다.').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=인적사항 수정').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    