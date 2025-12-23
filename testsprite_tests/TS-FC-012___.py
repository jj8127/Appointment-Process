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
        # -> Input 관리자 코드 1111 and click 시작하기 to login.
        frame = context.pages[-1]
        # Input 관리자 코드 1111
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[2]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        frame = context.pages[-1]
        # Click 시작하기 button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div[2]/div/div/div/div[2]/div[3]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on the 시험 홈 tab or button to navigate to 시험 신청자 관리 화면.
        frame = context.pages[-1]
        # Click 시험 홈 tab to navigate to 시험 신청자 관리 화면
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div[2]/div/div/div[2]/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on 생명/제3 신청자 or 손해 신청자 to go to 시험 신청자 관리 화면 and check 주민번호 display.
        frame = context.pages[-1]
        # Click 생명/제3 신청자 to go to 시험 신청자 관리 화면
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div[2]/div/div/div/div/div/div/div[6]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try to load applicant data by clicking the '전체' tab to list all applicants and check 주민번호 display.
        frame = context.pages[-1]
        # Click '전체' tab to list all applicants
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div[2]/div/div/div/div/div/div/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try searching for an applicant by entering a name or phone number in the search input to load data and verify 주민번호 masking.
        frame = context.pages[-1]
        # Input 'test' in the 이름, 전화번호 검색 input to search for applicants
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div[2]/div/div/div/div/div/div/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('test')
        

        frame = context.pages[-1]
        # Click search icon to perform search
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div[2]/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Try searching with an empty string or other common terms to load any applicant data to verify 주민번호 masking.
        frame = context.pages[-1]
        # Clear search input to try loading all applicants
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div[2]/div/div/div/div/div/div/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('')
        

        frame = context.pages[-1]
        # Click search icon to perform search with empty input
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div[2]/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Since no applicant data is available in 생명/제3 신청자 관리, try navigating to 손해 신청자 관리 screen to check for applicant data and 주민번호 masking.
        frame = context.pages[-1]
        # Click '생명/제3 신청자 관리' tab or header to check if it leads to other applicant management options or try to find navigation to 손해 신청자 관리
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Click on 손해 신청자 (index 10) to go to 손해 신청자 신청 현황 조회 and verify 주민번호 display.
        frame = context.pages[-1]
        # Click 손해 신청자 to go to 신청 현황 조회
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div[2]/div/div/div/div/div/div/div[6]/div[4]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        try:
            await expect(frame.locator('text=주민번호 평문 노출 확인 완료').first).to_be_visible(timeout=1000)
        except AssertionError:
            raise AssertionError("Test case failed: 주민번호 평문이 관리자 화면에 노출되지 않아야 합니다. 주민번호 마스킹 값만 표시되어야 하는데, 평문이 노출된 것으로 간주되어 테스트가 실패했습니다.")
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    