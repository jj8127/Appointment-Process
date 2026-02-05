-- 특정 전화번호가 회원가입되어 있는지 확인
-- 사용법: 전화번호를 '01012345678' 형식으로 입력

-- 1. FC 프로필 확인
SELECT
  id,
  phone,
  name,
  phone_verified,
  created_at
FROM fc_profiles
WHERE phone = '01012345678'; -- 여기에 테스트한 전화번호 입력

-- 2. 비밀번호 설정 여부 확인
SELECT
  fc.phone,
  fc.name,
  creds.password_set_at,
  CASE
    WHEN creds.password_set_at IS NULL THEN '비밀번호 미설정'
    ELSE '비밀번호 설정됨'
  END as status
FROM fc_profiles fc
LEFT JOIN fc_credentials creds ON fc.id = creds.fc_id
WHERE fc.phone = '01012345678'; -- 여기에 테스트한 전화번호 입력
