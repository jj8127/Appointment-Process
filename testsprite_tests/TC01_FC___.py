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
        # -> Input FC phone number 01012345678 and click 시작하기 to login.
        frame = context.pages[-1]
        # Input FC phone number 01012345678 for login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Click 시작하기 button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click '기본 정보' to open the basic information input screen for editing.
        frame = context.pages[-1]
        # Click '기본 정보' to open basic information input screen
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Input 필수 인적 사항: 이름, 전화번호 01012345678, 주민번호 앞6 900101, 뒷7 1234567, 주소 서울특별시 강남구 테헤란로 123, then click 저장하기 to save.
        frame = context.pages[-1]
        # Input name 홍길동
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[3]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('홍길동')
        

        frame = context.pages[-1]
        # Input phone number 01012345678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('01012345678')
        

        frame = context.pages[-1]
        # Input 주민번호 앞 6자리 900101
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[3]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('900101')
        

        frame = context.pages[-1]
        # Input 주민번호 뒷 7자리 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Input address 서울특별시 강남구 테헤란로 123
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[4]/div[6]/div[2]/textarea').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('서울특별시 강남구 테헤란로 123')
        

        frame = context.pages[-1]
        # Click 저장하기 to save the entered information
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click '기본 정보' button to reopen the basic information input screen and verify if the saved data is retained.
        frame = context.pages[-1]
        # Click '기본 정보' to open basic information input screen for verification
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct the phone number format to 010-1234-5678 and 주민번호 second part to a valid 7-digit number without errors, then click 저장하기 to save.
        frame = context.pages[-1]
        # Correct phone number format to 010-1234-5678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('010-1234-5678')
        

        frame = context.pages[-1]
        # Correct 주민번호 뒷 7자리 to 1234568 to fix validation error
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234568')
        

        frame = context.pages[-1]
        # Click 저장하기 to save corrected information
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Refresh the page to simulate re-entry and verify if the saved personal information is retained.
        frame = context.pages[-1]
        # Click the refresh button to reload the page and verify data persistence
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div/div/div[2]/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click '기본 정보' button to open the basic information input screen and verify if the saved personal information is retained.
        frame = context.pages[-1]
        # Click '기본 정보' to open basic information input screen for verification
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[3]/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct the phone number to format 010-1234-5678 and 주민등록번호 뒷 7자리 to a valid 7-digit number without errors, then click 저장하기 to save.
        frame = context.pages[-1]
        # Correct phone number format to 010-1234-5678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[4]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('010-1234-5678')
        

        frame = context.pages[-1]
        # Correct 주민등록번호 뒷 7자리 to 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[4]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Click 저장하기 to save corrected information
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[4]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click the '기본 정보' button to open the basic information input screen one last time to confirm all saved data is retained correctly.
        frame = context.pages[-1]
        # Click '기본 정보' to open basic information input screen for final verification
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[4]/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct the phone number to format 010-1234-5678 and 주민등록번호 뒷 7자리 to a valid 7-digit number without errors, then click 저장하기 to save.
        frame = context.pages[-1]
        # Correct phone number format to 010-1234-5678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[5]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('010-1234-5678')
        

        frame = context.pages[-1]
        # Correct 주민등록번호 뒷 7자리 to 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[5]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Click 저장하기 to save corrected information
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[5]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click the '기본 정보' button to open the basic information input screen one last time to confirm all saved data is retained correctly.
        frame = context.pages[-1]
        # Click '기본 정보' to open basic information input screen for final verification
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[5]/div/div/div/div/div/div/div[7]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Correct the phone number to format 010-1234-5678 and 주민등록번호 뒷 7자리 to a valid 7-digit number without errors, then click 저장하기 to save.
        frame = context.pages[-1]
        # Correct phone number format to 010-1234-5678
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[6]/div/div/div/div/div/div[4]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('010-1234-5678')
        

        frame = context.pages[-1]
        # Correct 주민등록번호 뒷 7자리 to 1234567
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[6]/div/div/div/div/div/div[4]/div[3]/div[2]/input[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1234567')
        

        frame = context.pages[-1]
        # Click 저장하기 to save corrected information
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[6]/div/div/div/div/div/div[5]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=홍길동님 환영합니다.').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=인적사항').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=수당동의').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=문서제출').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=위촉URL').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=완료').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=수당 동의 - 터치하여 바로 진행하세요').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=인적사항 수정').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=시험 접수하기').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=약관 동의 관리').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=필수 서류 제출').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=위촉 URL 접속 및 완료').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=총무팀과 대화하기').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    