#!/usr/bin/env python3
"""SQLite live backup script with online backup API, attachment archiving, and retention."""

import argparse
import datetime
import json
import os
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def perform_backup(db_path: Path, attachments_dir: Path, backup_dir: Path, retention: int):
    if not db_path.exists():
        print(f"Error: Database file not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
    archive_name = f"backup_{stamp}.zip"
    archive_path = backup_dir / archive_name

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        temp_db = temp_path / "app.db"

        # 1. Atomic SQLite online backup
        print(f"[*] Starting atomic SQLite backup from {db_path}...")
        src_conn = sqlite3.connect(db_path)
        dst_conn = sqlite3.connect(temp_db)
        try:
            src_conn.backup(dst_conn)
        finally:
            dst_conn.close()
            src_conn.close()
        print(f"[+] SQLite snapshot completed: {temp_db.stat().st_size:,} bytes")

        # 2. Package into ZIP with attachments and manifest
        manifest = {
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source_db": str(db_path),
            "db_size_bytes": temp_db.stat().st_size,
            "attachments_count": 0,
            "attachments_size_bytes": 0,
        }

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_out:
            zip_out.write(temp_db, arcname="app.db")

            if attachments_dir.exists() and attachments_dir.is_dir():
                for file_path in attachments_dir.glob("*"):
                    if file_path.is_file():
                        zip_out.write(file_path, arcname=f"attachments/{file_path.name}")
                        manifest["attachments_count"] += 1
                        manifest["attachments_size_bytes"] += file_path.stat().st_size

            zip_out.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

    print(f"[+] Backup archive created: {archive_path} ({archive_path.stat().st_size:,} bytes)")
    print(f"    - Included DB snapshot ({manifest['db_size_bytes']:,} bytes)")
    print(f"    - Included {manifest['attachments_count']} attachments ({manifest['attachments_size_bytes']:,} bytes)")

    # 3. Apply retention policy
    existing_backups = sorted(backup_dir.glob("backup_*.zip"), key=lambda p: p.stat().st_mtime)
    if len(existing_backups) > retention:
        to_prune = existing_backups[:-retention]
        print(f"[*] Pruning {len(to_prune)} old backup(s) exceeding retention limit of {retention}...")
        for old_backup in to_prune:
            try:
                old_backup.unlink()
                print(f"    - Removed {old_backup.name}")
            except Exception as e:
                print(f"    ! Failed to remove {old_backup.name}: {e}", file=sys.stderr)

    remaining = sorted(backup_dir.glob("backup_*.zip"), key=lambda p: p.stat().st_mtime)
    print(f"[OK] Backup routine complete. Total backups retained: {len(remaining)}")


def main():
    parser = argparse.ArgumentParser(description="Live backup tool for Service Desk SQLite & attachments")
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "app.db", help="Path to SQLite database file")
    parser.add_argument("--attachments", type=Path, default=ROOT / "data" / "app_attachments", help="Path to attachments directory")
    parser.add_argument("--backup-dir", type=Path, default=ROOT / "data" / "backups", help="Directory where backup archives will be stored")
    parser.add_argument("--retention", type=int, default=7, help="Number of backups to keep (default: 7)")
    args = parser.parse_args()

    perform_backup(args.db, args.attachments, args.backup_dir, args.retention)


if __name__ == "__main__":
    main()
