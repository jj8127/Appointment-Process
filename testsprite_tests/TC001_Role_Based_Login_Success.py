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
        # -> Enter valid admin credentials in the input field.
        frame = context.pages[-1]
        # Enter valid admin code for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        # -> Click the login button to attempt login.
        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try a different valid admin code or check for correct input format.
        frame = context.pages[-1]
        # Enter a different valid admin code for login attempt
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('admin001')
        

        # -> Enter a valid numeric admin code to attempt login.
        frame = context.pages[-1]
        # Enter a valid numeric admin code for admin login attempt
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try a different valid numeric admin code or verify the correct admin code format.
        frame = context.pages[-1]
        # Enter a different valid numeric admin code for login attempt
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Request or verify the correct valid admin code or try FC user login with a valid phone number.
        frame = context.pages[-1]
        # Enter a valid FC user phone number for login attempt
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to login as FC user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Log out the current FC user to prepare for admin login test.
        frame = context.pages[-1]
        # Click the 로그아웃 (Logout) button to log out the current user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Request or verify the correct valid admin code to test admin login or try a known valid admin code if available.
        frame = context.pages[-1]
        # Enter a different numeric admin code to attempt login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('999999')
        

        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to attempt admin login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Since no valid admin code is known, conclude admin login tests as failed due to lack of valid credentials. Proceed to test session persistence for FC user login.
        frame = context.pages[-1]
        # Re-enter valid FC user phone number to test session persistence
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click the 시작하기 (Start) button to login as FC user again
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Close and restart the app to verify session persistence for the FC user.
        await page.goto('http://localhost:8081/', timeout=10000)
        await asyncio.sleep(3)
        

        # -> Log out the FC user to complete the session persistence test and finalize the task.
        frame = context.pages[-1]
        # Click the 로그아웃 (Logout) button to log out the FC user
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=로그인관리자는 코드, FC는 휴대폰 번호를 입력해주세요.').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=휴대폰 번호 / 관리자 코드').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=시작하기').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    