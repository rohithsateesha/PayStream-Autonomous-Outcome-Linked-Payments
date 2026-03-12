# Running PayStream

## 1. One-time AWS setup (if you have creds)
```bash
cd paystream
source venv/Scripts/activate   # Windows: venv\Scripts\activate
python infra/setup_aws.py
```

## 2. Copy .env
```bash
cp .env.example .env
# Fill in AWS keys + Pine Labs key
# Leave PINE_LABS_MOCK=true for demo
```

## 3. Start backend
```bash
cd backend
uvicorn main:app --reload --port 8000
```

## 4. Start frontend (new terminal)
```bash
cd frontend
npm run dev
# Opens at http://localhost:5173
```

## 5. Demo flow
1. Type rule → Compile → see JSON
2. Start Session → watch chart + payment log
3. At ~60s chart dips, payments turn red
4. At ~90s recovery, payments go green
5. Click "Settle Session" → see AI explanation
