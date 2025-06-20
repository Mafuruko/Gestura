import cv2
import torch
import numpy as np
import torch.nn.functional as F
from collections import deque
from pytorch_i3d import InceptionI3d
import sys

# ——— SETTING ———
DEVICE = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
WEIGHTS = 'FINAL_nslt_100_iters=896_top1=65.89_top5=84.11_top10=89.92.pt'
LABELS  = 'wlasl_class_list.txt'

# ——— MODEL LOAD ———
model = InceptionI3d(400, in_channels=3)
model.replace_logits(100)
model.load_state_dict(torch.load(WEIGHTS, map_location=DEVICE))
model = torch.nn.DataParallel(model).to(DEVICE).eval()

with open(LABELS) as f:
    idx2word = [l.strip() for l in f]

# ——— PREPROCESS VIDEO BUFFER ———
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

# ——— PREDICT ———
def predict(frames):
    clip = preprocess_buffer(frames)
    with torch.no_grad():
        logits = model(clip)
        logits = logits.squeeze(-1).squeeze(-1)
        preds  = logits.max(dim=2)[0][0]
        probs  = F.softmax(preds, dim=0)
        idx    = probs.argmax().item()
    return idx2word[idx], probs[idx].item()

# ——— MAIN ENTRY ———
def main(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[ERROR] Gagal membuka video: {video_path}")
        return

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"[INFO] Video dimuat: {frame_count} frames, {fps:.2f} FPS")

    buffer = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        buffer.append(frame)
    cap.release()

    if len(buffer) < 16:
        print("[WARNING] Video terlalu pendek untuk dianalisis.")
        return

    word, conf = predict(buffer)
    print(f"\n[RESULT] Terdeteksi: {word} ({conf*100:.2f}%)")

# ——— RUN ———
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python video_input_predict.py path_to_video.mp4")
    else:
        main(sys.argv[1])