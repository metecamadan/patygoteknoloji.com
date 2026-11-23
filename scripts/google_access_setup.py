#!/usr/bin/env python3
"""Patygo — GA4 + Search Console kalıcı erişim bilgisi (yerel, git dışı).

JSON key ve ID'ler %USERPROFILE%\\.patygo\\google-api.json içine yazılır.
Sohbete / repoya yazılmaz.
"""
from __future__ import annotations

import json
import os
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

OUT_DIR = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".patygo"
OUT_FILE = OUT_DIR / "google-api.json"
DEFAULT_SITE = "https://patygoteknoloji.com/"
DEFAULT_GA = "G-ZW8V1C7EL0"


def load_existing() -> dict:
    if not OUT_FILE.is_file():
        return {}
    try:
        return json.loads(OUT_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save(data: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(OUT_FILE, 0o600)
    except OSError:
        pass


def main() -> int:
    existing = load_existing()
    root = tk.Tk()
    root.title("Patygo — Google kalıcı erişim")
    root.geometry("640x520")
    root.minsize(520, 440)

    frm = ttk.Frame(root, padding=16)
    frm.pack(fill=tk.BOTH, expand=True)

    ttk.Label(
        frm,
        text="Service account JSON + site/property ID. Dosya yalnızca bu PC'de kalır.",
        wraplength=580,
    ).pack(anchor=tk.W, pady=(0, 12))

    # JSON key path
    ttk.Label(frm, text="Service account JSON dosyası").pack(anchor=tk.W)
    key_var = tk.StringVar(value=str(existing.get("serviceAccountJsonPath") or ""))
    key_row = ttk.Frame(frm)
    key_row.pack(fill=tk.X, pady=(2, 8))
    key_entry = ttk.Entry(key_row, textvariable=key_var)
    key_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)

    def browse() -> None:
        path = filedialog.askopenfilename(
            title="Service account JSON seç",
            filetypes=[("JSON", "*.json"), ("All", "*.*")],
        )
        if path:
            key_var.set(path)

    ttk.Button(key_row, text="Seç…", command=browse).pack(side=tk.LEFT, padx=(8, 0))

    # Or paste client email if key already chosen (read-only hint)
    ttk.Label(frm, text="GA4 Measurement ID (ör. G-ZW8V1C7EL0)").pack(anchor=tk.W)
    ga_mid = tk.StringVar(value=str(existing.get("ga4MeasurementId") or DEFAULT_GA))
    ttk.Entry(frm, textvariable=ga_mid).pack(fill=tk.X, pady=(2, 8))

    ttk.Label(frm, text="GA4 Property ID (yalnız sayı, Admin → Property settings)").pack(anchor=tk.W)
    ga_prop = tk.StringVar(value=str(existing.get("ga4PropertyId") or ""))
    ttk.Entry(frm, textvariable=ga_prop).pack(fill=tk.X, pady=(2, 8))

    ttk.Label(frm, text="Search Console site URL").pack(anchor=tk.W)
    site = tk.StringVar(value=str(existing.get("searchConsoleSiteUrl") or DEFAULT_SITE))
    ttk.Entry(frm, textvariable=site).pack(fill=tk.X, pady=(2, 8))

    ttk.Label(
        frm,
        text="Not: Google Cloud'da Search Console API + Google Analytics Data API açık olmalı.\n"
        "Service account e-postasını GSC'de kullanıcı (Tam) ve GA4'te Viewer olarak ekle.",
        wraplength=580,
    ).pack(anchor=tk.W, pady=(4, 12))

    status = tk.StringVar(value=f"Kayıt yolu: {OUT_FILE}")
    ttk.Label(frm, textvariable=status, foreground="#444").pack(anchor=tk.W)

    def on_save() -> None:
        path = key_var.get().strip().strip('"')
        if not path or not Path(path).is_file():
            messagebox.showerror("Eksik", "Geçerli bir service account JSON dosyası seç.")
            return
        try:
            sa = json.loads(Path(path).read_text(encoding="utf-8"))
        except Exception as exc:
            messagebox.showerror("JSON", f"JSON okunamadı: {exc}")
            return
        email = sa.get("client_email")
        if not email or "private_key" not in sa:
            messagebox.showerror("JSON", "Bu dosya service account key gibi görünmüyor.")
            return
        prop = ga_prop.get().strip()
        if prop and not prop.isdigit():
            messagebox.showerror("GA4", "Property ID yalnız rakam olmalı.")
            return
        site_url = site.get().strip() or DEFAULT_SITE
        if not site_url.startswith("http"):
            messagebox.showerror("GSC", "Site URL https:// ile başlamalı.")
            return

        # Copy key into .patygo (not the Downloads path)
        key_dest = OUT_DIR / "google-service-account.json"
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        key_dest.write_text(json.dumps(sa, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        try:
            os.chmod(key_dest, 0o600)
        except OSError:
            pass

        payload = {
            "serviceAccountJsonPath": str(key_dest),
            "serviceAccountEmail": email,
            "ga4MeasurementId": ga_mid.get().strip() or DEFAULT_GA,
            "ga4PropertyId": prop,
            "searchConsoleSiteUrl": site_url if site_url.endswith("/") else site_url + "/",
        }
        save(payload)
        status.set(f"Kaydedildi: {OUT_FILE}")
        messagebox.showinfo(
            "Tamam",
            f"Kaydedildi.\n\nService account:\n{email}\n\n"
            "Şimdi Google'da bu e-postayı GSC + GA4'e ekle.\n"
            f"Dosya: {OUT_FILE}",
        )

    btn_row = ttk.Frame(frm)
    btn_row.pack(fill=tk.X, pady=(16, 0))
    ttk.Button(btn_row, text="Kaydet", command=on_save).pack(side=tk.LEFT)
    ttk.Button(btn_row, text="Kapat", command=root.destroy).pack(side=tk.LEFT, padx=(8, 0))

    # Bring to front on Windows
    root.lift()
    root.attributes("-topmost", True)
    root.after(200, lambda: root.attributes("-topmost", False))
    root.focus_force()
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
