import cv2
import torch
import numpy as np
import torch.nn.functional as F
import time
from collections import deque
from pytorch_i3d import InceptionI3d

# ——— TIMING CONFIG ———
IDLE_DURATION      = 0    # seconds between prompts
COUNTDOWN_DURATION = 3     # “3…2…1…Ready!”
PERFORM_DURATION   = 3     # seconds to record your sign
# WINDOW_SIZE will be set from PERFORM_DURATION × fps

DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# ——— 100‐CLASS CHECKPOINT & LABELS ———
WEIGHTS = 'FINAL_nslt_100_iters=896_top1=65.89_top5=84.11_top10=89.92.pt'
LABELS  = 'wlasl_class_list.txt'  # 100 lines, one per class

# ——— MODEL SETUP ———
model = InceptionI3d(400, in_channels=3)
model.replace_logits(100)
model.load_state_dict(torch.load(WEIGHTS, map_location='cpu'))
model = torch.nn.DataParallel(model).to(DEVICE).eval()

with open(LABELS) as f:
    idx2word = [l.strip() for l in f]

# ——— PREPROCESS ———
def preprocess_buffer(frames):
    proc = []
    for img in frames:
        h, w = img.shape[:2]
        scale = 224.0 / h
        img = cv2.resize(img, dsize=(0,0), fx=scale, fy=scale)
        h2, w2 = img.shape[:2]
        x0 = (w2 - 224)//2
        crop = img[:, x0:x0+224]
        norm = (crop.astype(np.float32)/255.0)*2.0 - 1.0
        proc.append(norm)
    arr = np.stack(proc, axis=0)                
    tns = torch.from_numpy(arr).permute(3,0,1,2)  
    return tns.unsqueeze(0).to(DEVICE)            

# ——— INFERENCE ———
def predict(frames):
    clip = preprocess_buffer(frames)
    with torch.no_grad():
        logits = model(clip)                       
        logits = logits.squeeze(-1).squeeze(-1)    
        preds  = logits.max(dim=2)[0][0]           
        probs  = F.softmax(preds, dim=0)
        idx    = probs.argmax().item()
    return idx2word[idx], probs[idx].item()

# ——— MAIN LOOP ———
cap = cv2.VideoCapture(0)
fps = cap.get(cv2.CAP_PROP_FPS) or 30
WINDOW_SIZE = int(PERFORM_DURATION * fps)
buffer = deque(maxlen=WINDOW_SIZE)

state = 'idle'
state_start = time.time()
last_prediction = ""

while True:
    ret, frame = cap.read()
    if not ret:
        break

    now = time.time()
    elapsed = now - state_start

    # State transitions
    if state == 'idle' and elapsed >= IDLE_DURATION:
        state = 'countdown'
        state_start = now

    elif state == 'countdown' and elapsed >= COUNTDOWN_DURATION:
        state = 'record'
        state_start = now
        buffer.clear()

    elif state == 'record' and elapsed >= PERFORM_DURATION:
        if len(buffer) == WINDOW_SIZE:
            w, c = predict(list(buffer))
            last_prediction = f"{w} ({c*100:.1f}%)"
        else:
            last_prediction = "Too few frames!"
        state = 'idle'
        state_start = now

    # Collect during record period
    if state == 'record':
        buffer.append(frame)

    # Overlay UI
    if state == 'countdown':
        rem = COUNTDOWN_DURATION - int(elapsed)
        overlay = f"{rem if rem>0 else 'Ready!'}"
    elif state == 'record':
        overlay = "Recording..."
    else:  # idle
        overlay = f"Next in {int(IDLE_DURATION - elapsed)}s"

    cv2.putText(frame, overlay, (10,30),
                cv2.FONT_HERSHEY_SIMPLEX, 1.2,
                (0,255,255), 2, cv2.LINE_AA)
    cv2.putText(frame, last_prediction, (10,70),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0,
                (0,255,0), 2, cv2.LINE_AA)

    cv2.imshow("ASL Real-Time", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()