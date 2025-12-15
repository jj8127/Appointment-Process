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
        # -> Input 관리자 코드 1111 and click 시작하기 to login as 총무.
        frame = context.pages[-1]
        # Input 관리자 코드 1111 for 총무 login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[3]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('1111')
        

        frame = context.pages[-1]
        # Click 시작하기 button to login
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div[2]/div[4]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Find and click the element to open FC 목록 (list of FCs) to manage FC 임시사번 and 경력 유형.
        frame = context.pages[-1]
        # Click '수당 동의 안내' to open FC 목록 or related FC management page
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div/div/div/div/div/div/div/div[6]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> Select an FC with 임시사번 미발급 (e.g., 박상준) to issue 임시사번 and set 경력 유형.
        frame = context.pages[-1]
        # Click on 박상준 FC entry with 임시사번 미발급 to open detail for issuing 임시사번 and setting 경력 유형
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> 입력 필드에 임시사번 'T-12345' 입력하고 경력 유형 '신입' 선택 후 저장 버튼 클릭.
        frame = context.pages[-1]
        # 임시사번 입력란에 'T-12345' 입력
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div[2]/div[2]/div[3]/div[2]/div[2]/input').nth(0)
        await page.wait_for_timeout(3000); await elem.fill('T-12345')
        

        frame = context.pages[-1]
        # 경력 유형 중 '신입' 선택
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div[2]/div[2]/div[3]/div[2]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        frame = context.pages[-1]
        # 저장 버튼 클릭하여 임시사번과 경력 유형 저장
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div[2]/div[2]/div[3]/div[2]/div[2]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> FC로 다시 로그인하거나 새로고침하여 FC 수당 동의/프로필 화면에 임시사번과 경력 유형이 표시되는지 확인.
        frame = context.pages[-1]
        # 클릭하여 대시보드에서 로그아웃 또는 메뉴 이동 후 FC로 다시 로그인 또는 새로고침 준비
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        frame = context.pages[-1]
        # 박상준 FC 항목 클릭하여 상세 정보 확인 준비
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> FC로 다시 로그인하거나 새로고침하여 FC 수당 동의/프로필 화면에 임시사번과 경력 유형이 표시되는지 확인.
        frame = context.pages[-1]
        # Click 이선옥 FC to open FC 수당 동의/프로필 화면 for 확인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> FC로 다시 로그인하거나 새로고침하여 FC 수당 동의/프로필 화면에 임시사번과 경력 유형이 표시되는지 확인.
        frame = context.pages[-1]
        # 클릭하여 메뉴 또는 로그아웃 후 FC로 다시 로그인 또는 새로고침 준비
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> 임시사번 미발급 상태인 박상준 FC를 클릭하여 상세 정보 확인 후 임시사번과 경력 유형이 반영되었는지 확인.
        frame = context.pages[-1]
        # 박상준 FC 항목 클릭하여 상세 정보 확인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> FC로 다시 로그인하거나 새로고침하여 FC 수당 동의/프로필 화면에 임시사번과 경력 유형이 표시되는지 확인.
        frame = context.pages[-1]
        # 클릭하여 메뉴 또는 로그아웃 후 FC로 다시 로그인 또는 새로고침 준비
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> FC로 다시 로그인하거나 새로고침하여 FC 수당 동의/프로필 화면에 임시사번과 경력 유형이 표시되는지 확인.
        frame = context.pages[-1]
        # 클릭하여 메뉴 또는 로그아웃 후 FC로 다시 로그인 또는 새로고침 준비
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div/div/div[2]').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> 임시사번 미발급 상태인 박상준 FC도 동일하게 임시사번과 경력구분이 정확히 표시되는지 확인.
        frame = context.pages[-1]
        # 박상준 FC 항목 클릭하여 상세 정보 확인
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # -> 임시사번이 FC 화면에 반영되지 않는 문제 확인 및 재발급 또는 새로고침 등 추가 조치 필요.
        frame = context.pages[-1]
        # 박상준 FC 상세 정보 다시 클릭하여 임시사번 재확인 및 수정 시도
        elem = frame.locator('xpath=html/body/div/div/div/div/div[2]/div[2]/div/div/div/div/div/div/div[2]/div[3]/div').nth(0)
        await page.wait_for_timeout(3000); await elem.click(timeout=5000)
        

        # --> Assertions to verify final state
        frame = context.pages[-1]
        await expect(frame.locator('text=T-12345').first).to_be_visible(timeout=30000)
        await expect(frame.locator('text=신입').first).to_be_visible(timeout=30000)
        await asyncio.sleep(5)
    
    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()
            
asyncio.run(run_test())
    