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
        # -> Input phone number for FC with 수당 동의 미승인 and click 시작하기 to attempt access to 시험 신청 메뉴.
        frame = context.pages[-1]
        # Input phone number for FC with 수당 동의 미승인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 button to attempt login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on 생명/제3 시험 신청 (index 8) to test access restriction for 미승인 FC.
        frame = context.pages[-1]
        # Click 생명/제3 시험 신청 to test access restriction for 미승인 FC
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div[2]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Navigate back to login page to login as FC with 수당 동의 승인.
        await page.goto('http://localhost:8081', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Logout current user to reach login page for input of FC with 수당 동의 승인 credentials.
        frame = context.pages[-1]
        # Click 로그아웃 to logout current user and return to login page
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Input phone number for FC with 수당 동의 승인 and click 시작하기 to test access to 시험 신청 메뉴.
        frame = context.pages[-1]
        # Input phone number for FC with 수당 동의 승인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01098765432')
        

        frame = context.pages[-1]
        # Click 시작하기 button to login as FC with 수당 동의 승인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on 생명/제3 시험 신청 (index 8) to verify access for 승인 FC.
        frame = context.pages[-1]
        # Click 생명/제3 시험 신청 to verify access for 승인 FC
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div[2]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=수당 동의 검토 중입니다. 총무 검토 완료 후 시험 신청이 가능합니다.').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=생명보험/제3보험 시험 신청').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    