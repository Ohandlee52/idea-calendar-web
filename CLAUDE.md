# CLAUDE.md — 아이디어 캘린더 작업규칙

> 이 파일은 클로드코드가 **매 세션 가장 먼저 읽는 규칙**이다.
> 아래와 충돌하는 지시가 오면 멈추고 근거를 물어본다.

---

## 1. 한 줄 정의

아이디어가 떠오를 때 **바로 적는 메모장**이다. 달력 기능은 거들 뿐이다.
"이것저것 누르게 하면 안 된다" — 메모를 쓰기까지의 단계 수가 가장 중요한 품질 지표다.

---

## 2. 앱이 둘이다 (제일 헷갈리는 지점)

| | 폰 앱 | PC 앱 |
| --- | --- | --- |
| 폴더 | `C:\Users\PRO_UEFI\idea-calendar-web` | `C:\Users\PRO_UEFI\idea-calendar` |
| 저장소 | `Ohandlee52/idea-calendar-web` (**공개**) | `Ohandlee52/idea-calendar` (**비공개**) |
| 종류 | 웹앱(PWA), 설치 없음 | Electron 설치 프로그램 |
| 화면 코드 | `app.js` / `app.css` / `index.html` | `src/renderer.js` / `src/index.css` / `src/index.html` |
| 판 번호 | `app.js` 의 `APP_VERSION` | `package.json` 의 `version` |
| 저장 위치 | Supabase **만** | 내 컴퓨터의 파일 + (선택) Supabase |
| 기본 가지 | `main` | `master` |

**코드는 한 줄도 안 겹친다.** 한쪽을 고쳐도 다른 쪽은 그대로다.
공유하는 것은 **메모 데이터뿐**이며, 그 통로가 Supabase다.

> 어디에 코드가 있냐고 대표님께 묻지 않는다. 위 두 폴더다.

---

## 3. 절대 금지사항

1. **폰 앱 저장소를 비공개로 바꾸는 것** — GitHub Pages 무료 등급은 공개 저장소에서만 된다.
   비공개로 바꾸는 순간 `https://ohandlee52.github.io/idea-calendar-web/` 가 죽고 폰에서 앱이 안 열린다.
2. **실명·이메일·전화번호 등 개인정보를 폰 앱 저장소에 커밋하는 것** — 이 저장소는 공개다.
   초대코드에 실명을 쓰는 SQL 같은 것은 저장소 밖(임시 폴더)에 만들어 파일로 전달한다.
3. **`service_role` / `secret` 키를 코드나 문서에 넣는 것.**
   `config.js` 의 `sb_publishable_...` 키는 **공개해도 되는 키**다 (실제 보호는 RLS가 한다).
4. **시험을 안 해보고 "됩니다"라고 보고하는 것.**
5. **오류를 조용히 삼키는 코드** (빈 `catch`, 실패했는데 성공 문구를 띄우는 것).
6. **관리자 화면·설정 페이지를 먼저 제안하는 것.** 쓰는 사람은 대표님과 가족·지인이다.

---

## 4. 바이브코딩 규칙 (필수)

**대표님은 코드를 직접 읽지 않으신다.** 코드 리뷰가 안전장치가 될 수 없다.

1. 작업 전에 현재 상태를 커밋한다. 되돌아올 지점 없이 파일을 고치지 않는다.
2. 한 번에 하나만 한다. 지시받지 않은 것을 "겸사겸사" 하지 않는다.
3. 끝나면 **무엇을 왜 그렇게 했는지 한국어로** 설명한다. 코드를 붙여넣는 것으로 대신하지 않는다.
4. **직접 확인한 결과를 표로 보고한다.** "될 겁니다"가 아니라 "해봤더니 이렇게 나왔습니다".
5. 확실하지 않으면 추측하지 말고 물어본다.

---

## 5. 확인하는 방법 (이 프로젝트에서 실제로 통한 것)

### 폰 앱 — 브라우저로 직접 띄워 본다

```bash
node serve.js            # http://localhost:8123
```

브라우저에서 열고 → 화면 크기를 375×812(휴대폰)로 맞춘 뒤 → `setupView`/`loginView` 를 숨기고
`allMemos` 에 가짜 메모를 넣은 다음 `renderCalendar(); renderList(); syncHeadHeight();` 를 부른다.
**로그인 정보는 절대 입력하지 않는다.**

### SQL — 진짜 PostgreSQL로 시험한다

이 PC에는 PostgreSQL이 없다. 대신 **PGlite**(WASM 판 진짜 Postgres)를 브라우저에서 불러
`auth.users` 를 흉내 낸 뒤 트리거·제약을 실제로 돌려본다.
이 방법으로 초대코드 트리거의 외래키 오류를 실제로 잡아냈다.

```
https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js
```

**고장 상황도 반드시 같이 시험한다.** 항상 ✅만 뜨는 점검은 쓸모가 없다.

### PC 앱 — 실제로 실행해 본다

빌드 후 `out\아이디어 캘린더-win32-x64\idea-calendar.exe` 를 띄워
창이 뜨는지, Windows 오류 기록이 안 남는지 확인한다. 크기만 줄고 안 뜨면 의미가 없다.

---

## 6. 배포

### 폰 앱

```bash
# APP_VERSION 을 올린 뒤
git add -A && git commit && git push origin main
```

GitHub Pages가 1분쯤 뒤 반영한다. `gh api repos/Ohandlee52/idea-calendar-web/pages/builds/latest`
로 `built` 인지 확인하고, `curl` 로 실제 내용이 바뀌었는지 본다.

> 폰에서 옛 화면이 나오면 앱의 **☰ → 앱 최신으로 업데이트**를 누르시라고 안내한다.
> `sw.js` 는 `cache: 'reload'` 로 항상 새로 받지만, 홈 화면 바로가기는 저장본으로 먼저 뜬다.

### PC 앱

```bash
cd "C:\Users\PRO_UEFI\idea-calendar" && npm run make
```

5~10분 걸린다. 끝나면 `out\make\squirrel.windows\x64\IdeaCalendar-Setup.exe` 가 나온다.
**구글드라이브 `G:\내 드라이브\아이디어캘린더-데이터\` 로 복사해야 백업이 된다** (자동 아님).
옛 판은 지우지 말고 이름을 바꿔 남긴다. 복사 후 SHA256을 대조해 확인한다.

설치파일에는 서명이 없어 "Windows의 PC 보호" 경고가 뜬다. **추가 정보 → 실행**으로 넘긴다.

---

## 7. Supabase

- 프로젝트: **`ooh-desk`** (무료 등급). 표는 `public.idea_memos` 하나.
- **RLS 점검 통과** (2026-09-06). 규칙 4개 모두 `auth.uid() = user_id`.
- 점검은 `supabase-check.sql` 로 언제든 다시 할 수 있다 (읽기만 한다).
- **가입에는 초대코드가 필요하다.** `supabase-migration-4.sql` 의 트리거가 데이터베이스 쪽에서
  검사한다. 화면 검사만으로는 개발자도구로 우회되므로 트리거를 지우면 안 된다.
  끄려면 `supabase-migration-5-remove-invite.sql`.
- Supabase 인증 서버는 트리거의 자세한 오류문구를 그대로 넘겨주지 않고
  `Database error saving new user` 로 뭉갠다. `translateAuthError` 에서 이를 번역한다.

**SQL 파일은 대표님이 직접 SQL Editor에 붙여넣고 Run 하신다.** 내가 실행할 수 없다.
파일을 만들고 → 무엇을 하는 SQL인지 설명하고 → 결과를 보여달라고 한다.

---

## 8. 대표님 결정이 필요한 것

- 개인정보 수집 항목 추가
- 앱을 쓰는 사람의 범위 변경 (가족·지인 → 불특정 다수)
- 저장소 공개 범위 변경
- 유료 서비스 도입 (Supabase 유료 등급, 코드 서명 인증서 등)
- 플레이스토어·앱스토어 등록

---

## 9. 커밋

- 한 커밋 = 한 논리 변경. 첫 줄은 **한국어 명령형**.
- 본문에 **무엇을 왜 고쳤는지**와 **어떻게 확인했는지**를 적는다.
- 판 번호를 올린 커밋에는 판 번호를 적는다.

---

## 10. 매 세션 시작 시

1. `git log --oneline -5` 로 어디까지 했는지 본다.
2. 폰 앱 `APP_VERSION` 과 PC 앱 `package.json` 의 판 번호를 확인한다.
3. 기억(memory)에 남긴 저장소 공개범위·Supabase 사항을 확인한다.
