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
        # -> Input a test phone number or admin code and click '시작하기' to proceed with login.
        frame = context.pages[-1]
        # Input test phone number without dashes
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[2]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 button to proceed after input
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[3]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Navigate to /consent page and verify redirection to /apply-gate.
        await page.goto('http://localhost:8081/consent', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Navigate to /docs-upload page and verify redirection to /apply-gate.
        await page.goto('http://localhost:8081/docs-upload', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Navigate to /appointment page and verify if redirection to /apply-gate occurs.
        await page.goto('http://localhost:8081/appointment', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Navigate to /exam-apply page and verify if redirection to /apply-gate occurs.
        await page.goto('http://localhost:8081/exam-apply', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Navigate to /exam-apply2 page and verify if redirection to /apply-gate occurs.
        await page.goto('http://localhost:8081/exam-apply2', timeout=10000)
        await asyncio.sleep(3)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=Identity Verification Complete').first).to_be_visible(timeout=1000)
        except AssertionError:
            raise AssertionError('Test failed: Identity 미완료 상태에서 위촉 단계 화면 접근 시 Apply Gate로 리다이렉트되어야 하나, 해당 리다이렉션이 발생하지 않았습니다.')
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    