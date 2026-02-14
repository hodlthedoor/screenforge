#!/usr/bin/env python3
"""Smoke test script for ScreenForge Python SDK."""

import os
import sys
from pathlib import Path

# Add src to path for local testing
sys.path.insert(0, str(Path(__file__).parent / "src"))

from screenforge import ScreenForgeClient


def main():
    """Run smoke tests against a live ScreenForge instance."""
    api_key = os.getenv("SCREENFORGE_API_KEY", "test-key-local")
    base_url = os.getenv("SCREENFORGE_BASE_URL", "http://localhost:3101")

    print(f"Testing ScreenForge SDK against {base_url}")
    print(f"Using API key: {api_key[:10]}...")

    client = ScreenForgeClient(api_key=api_key, base_url=base_url)

    try:
        # Test 1: Async screenshot
        print("\n[1/2] Testing screenshot_async()...")
        job = client.screenshot_async("https://example.com")
        print(f"  ✓ Job ID: {job.jobId}")
        print(f"  ✓ Poll URL: {job.pollUrl}")

        # Test 2: Poll job
        print("\n[2/2] Testing poll_job()...")
        status = client.poll_job(job.jobId)
        print(f"  ✓ Job status: {status.status}")
        print(f"  ✓ Job type: {status.type}")
        print(f"  ✓ URL: {status.url}")

        print("\n✓ All smoke tests passed!")
        print("\nNote: Direct screenshot/pdf/og methods require running the render")
        print("      in non-async mode, which may take several seconds.")
        return 0

    except Exception as e:
        print(f"\n✗ Smoke test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main())
