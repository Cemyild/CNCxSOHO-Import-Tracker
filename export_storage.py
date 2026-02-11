import os
import sys
import zipfile

sys.path.insert(0, ".pythonlibs/lib/python3.11/site-packages")

from replit.object_storage import Client

client = Client(bucket_id="replit-objstore-c54c2463-cf31-4790-b4ba-beb7de4cdeb3")
objects = client.list()

os.makedirs("export_temp", exist_ok=True)

for obj in objects:
    print(f"İndiriliyor: {obj.name}")
    data = client.download_as_bytes(obj.name)
    path = os.path.join("export_temp", obj.name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)

with zipfile.ZipFile("storage_backup.zip", "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk("export_temp"):
        for file in files:
            full_path = os.path.join(root, file)
            arcname = os.path.relpath(full_path, "export_temp")
            zf.write(full_path, arcname)

print(f"\n✅ {len(objects)} dosya zip'lendi: storage_backup.zip")