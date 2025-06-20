import torch

# Buat tensor besar (10 juta elemen)
x = torch.rand(10000000, device='mps')  # Gunakan GPU Metal
y = torch.rand(10000000, device='cpu')   # Gunakan CPU

# Hitung waktu komputasi
def benchmark(tensor, name):
    start = torch.mps.Event(enable_timing=True)
    end = torch.mps.Event(enable_timing=True)
    start.record()
    torch.sqrt(tensor)
    end.record()
    torch.mps.synchronize()
    print(f"{name}: {start.elapsed_time(end):.2f} ms")

benchmark(x, "GPU M4")
benchmark(y, "CPU")