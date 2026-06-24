#!/usr/bin/env python3
"""
Screenshot utility for site migration verification.
Takes screenshots of pages for visual verification of extracted data.

Usage:
    python screenshot.py <url> [output_filename]

Environment variables:
    AUTH_COOKIE - Authentication cookie value for the target site
"""

import os
import sys
import argparse
from pathlib import Path

from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "migrate" / "screenshots"


def take_screenshot(url: str, output_path: str = None, auth_cookie: str = None):
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    
    if not output_path:
        import hashlib
        url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
        output_path = OUTPUT_DIR / f"{url_hash}.png"
    else:
        output_path = Path(output_path)
    
    print(f"Taking screenshot of: {url}")
    print(f"Output: {output_path}")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )
        
        if auth_cookie:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc
            
            cookies = []
            for part in auth_cookie.split(';'):
                part = part.strip()
                if '=' in part:
                    name, value = part.split('=', 1)
                    cookies.append({
                        'name': name.strip(),
                        'value': value.strip(),
                        'domain': domain,
                        'path': '/'
                    })
            
            if cookies:
                context.add_cookies(cookies)
        
        page = context.new_page()
        
        try:
            page.goto(url, wait_until='networkidle', timeout=60000)
            page.wait_for_timeout(2000)
            page.screenshot(path=str(output_path), full_page=True)
            print(f"Screenshot saved: {output_path}")
            
        except Exception as e:
            print(f"Error taking screenshot: {e}")
            page.screenshot(path=str(output_path))
            print(f"Partial screenshot saved: {output_path}")
        
        finally:
            browser.close()
    
    return output_path


def main():
    parser = argparse.ArgumentParser(description='Take screenshot of a webpage')
    parser.add_argument('url', help='URL to screenshot')
    parser.add_argument('--output', '-o', help='Output filename')
    
    args = parser.parse_args()
    
    auth_cookie = os.environ.get('AUTH_COOKIE', '')
    
    take_screenshot(args.url, args.output, auth_cookie)


if __name__ == '__main__':
    main()
