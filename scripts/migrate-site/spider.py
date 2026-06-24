#!/usr/bin/env python3
"""
Site Migration Spider
Crawls an ASP.NET website with authentication and extracts all content to JSON.
Uses SHA256 hashing to avoid revisiting pages.

Usage:
    python spider.py <seed_url>

Environment variables:
    AUTH_COOKIE - Authentication cookie value for the target site
    MIGRATION_URL - Reference URL (optional)
"""

import os
import sys
import json
import hashlib
import time
import argparse
from urllib.parse import urljoin, urlparse, urlunparse
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).parent
OUTPUT_DIR = SCRIPT_DIR / "migrate"
STATE_FILE = OUTPUT_DIR / "_spider_state.json"
VISITED_FILE = OUTPUT_DIR / "_visited_urls.txt"
DELAY_SECONDS = 2.0
MAX_PAGES = 1000

class SiteMigrationSpider:
    def __init__(self, seed_url: str, auth_cookie: str = None):
        if not seed_url.startswith(('http://', 'https://')):
            seed_url = 'https://' + seed_url
        self.seed_url = seed_url
        self.base_domain = urlparse(seed_url).netloc
        self.auth_cookie = auth_cookie
        
        self.visited_hashes = set()
        self.visited_urls = set()
        self.queue = []
        self.pages_scraped = 0
        
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Sec-Ch-Ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"macOS"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Priority': 'u=0, i',
        })
        
        if auth_cookie:
            self.session.headers['Cookie'] = auth_cookie
        
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        
        self.load_visited_urls()
        self.load_state()
    
    def load_visited_urls(self):
        if VISITED_FILE.exists():
            with open(VISITED_FILE, 'r') as f:
                for line in f:
                    url = line.strip()
                    if url:
                        self.visited_urls.add(url)
            print(f"Loaded {len(self.visited_urls)} visited URLs from _visited_urls.txt")
    
    def save_visited_url(self, url: str):
        with open(VISITED_FILE, 'a') as f:
            f.write(url + '\n')
        self.visited_urls.add(url)
    
    def url_hash(self, url: str) -> str:
        normalized = self.normalize_url(url)
        return hashlib.sha256(normalized.encode()).hexdigest()[:16]
    
    def normalize_url(self, url: str) -> str:
        parsed = urlparse(url)
        normalized = urlunparse((
            parsed.scheme,
            parsed.netloc,
            parsed.path.rstrip('/') or '/',
            '',
            parsed.query,
            ''
        ))
        return normalized
    
    def is_valid_url(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
            if parsed.netloc and parsed.netloc != self.base_domain:
                return False
            if parsed.scheme and parsed.scheme not in ('http', 'https'):
                return False
            if '/logout' in parsed.path.lower():
                return False
            skip_extensions = ('.jpg', '.jpeg', '.png', '.gif', '.css', '.js', '.ico', '.pdf', '.zip', '.exe', '.svg', '.woff', '.woff2', '.ttf', '.eot')
            if parsed.path.lower().endswith(skip_extensions):
                return False
            return True
        except:
            return False
    
    def save_state(self):
        state = {
            'visited_hashes': list(self.visited_hashes),
            'queue': self.queue,
            'pages_scraped': self.pages_scraped,
            'seed_url': self.seed_url,
            'last_updated': datetime.utcnow().isoformat()
        }
        with open(STATE_FILE, 'w') as f:
            json.dump(state, f, indent=2)
    
    def load_state(self):
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, 'r') as f:
                    state = json.load(f)
                if state.get('seed_url') == self.seed_url:
                    self.visited_hashes = set(state.get('visited_hashes', []))
                    self.queue = state.get('queue', [])
                    self.pages_scraped = state.get('pages_scraped', 0)
                    print(f"Resumed state: {len(self.visited_hashes)} pages visited, {len(self.queue)} in queue")
            except:
                pass
    
    def extract_links(self, soup: BeautifulSoup, current_url: str) -> list:
        links = []
        for a_tag in soup.find_all('a', href=True):
            href = a_tag['href']
            absolute_url = urljoin(current_url, href)
            if self.is_valid_url(absolute_url):
                links.append(absolute_url)
        return links
    
    def extract_page_data(self, url: str, soup: BeautifulSoup, html: str) -> dict:
        page_data = {
            'url': url,
            'url_hash': self.url_hash(url),
            'scraped_at': datetime.utcnow().isoformat(),
            'title': '',
            'meta': {},
            'headings': [],
            'text_content': '',
            'forms': [],
            'tables': [],
            'links': [],
            'images': [],
            'label_values': {},
            'scripts_data': [],
            'raw_html_length': len(html)
        }
        
        if soup.title:
            page_data['title'] = soup.title.get_text(strip=True)
        
        for meta in soup.find_all('meta'):
            name = meta.get('name') or meta.get('property', '')
            content = meta.get('content', '')
            if name and content:
                page_data['meta'][name] = content
        
        for level in range(1, 7):
            for heading in soup.find_all(f'h{level}'):
                page_data['headings'].append({
                    'level': level,
                    'text': heading.get_text(strip=True)
                })
        
        main_content = soup.find('main') or soup.find('article') or soup.find('div', {'id': 'content'}) or soup.find('div', {'class': 'content'}) or soup.body
        if main_content:
            for script in main_content.find_all('script'):
                script_text = script.get_text(strip=True)
                if script_text:
                    page_data['scripts_data'].append(script_text[:1000])
                script.decompose()
            for style in main_content.find_all('style'):
                style.decompose()
            page_data['text_content'] = main_content.get_text(separator=' ', strip=True)
        
        for form in soup.find_all('form'):
            form_data = {
                'action': form.get('action', ''),
                'method': form.get('method', 'get'),
                'id': form.get('id', ''),
                'name': form.get('name', ''),
                'fields': [],
                'field_data': {}
            }
            for input_elem in form.find_all(['input', 'select', 'textarea']):
                field_name = input_elem.get('name', '')
                field_id = input_elem.get('id', '')
                field_key = field_name or field_id
                field_value = input_elem.get('value', '')
                
                is_checked = input_elem.get('checked') is not None
                field_type = input_elem.get('type', 'text')
                
                if input_elem.name == 'textarea':
                    field_value = input_elem.get_text(strip=True)
                elif input_elem.name == 'select':
                    selected_opt = input_elem.find('option', selected=True)
                    field_value = selected_opt.get('value', '') if selected_opt else ''
                elif field_type in ('checkbox', 'radio'):
                    field_value = field_value if is_checked else ''
                
                field = {
                    'tag': input_elem.name,
                    'name': field_name,
                    'type': field_type,
                    'id': field_id,
                    'value': field_value,
                    'placeholder': input_elem.get('placeholder', ''),
                    'checked': is_checked,
                    'disabled': input_elem.get('disabled') is not None,
                    'readonly': input_elem.get('readonly') is not None
                }
                
                if input_elem.name == 'select':
                    field['options'] = [{
                        'value': opt.get('value', ''), 
                        'text': opt.get_text(strip=True),
                        'selected': opt.get('selected') is not None
                    } for opt in input_elem.find_all('option')]
                
                form_data['fields'].append(field)
                
                if field_key and field_value:
                    form_data['field_data'][field_key] = field_value
            
            page_data['forms'].append(form_data)
        
        for table in soup.find_all('table'):
            table_data = {
                'id': table.get('id', ''),
                'class': ' '.join(table.get('class', [])),
                'name': table.get('name', ''),
                'caption': '',
                'headers': [],
                'rows': [],
                'records': []
            }
            
            caption = table.find('caption')
            if caption:
                table_data['caption'] = caption.get_text(strip=True)
            
            thead = table.find('thead')
            if thead:
                header_row = thead.find('tr')
                if header_row:
                    for cell in header_row.find_all(['th', 'td']):
                        table_data['headers'].append(cell.get_text(strip=True))
            else:
                first_row = table.find('tr')
                if first_row:
                    header_cells = first_row.find_all('th')
                    if header_cells:
                        for th in header_cells:
                            table_data['headers'].append(th.get_text(strip=True))
            
            tbody = table.find('tbody') or table
            for row_index, tr in enumerate(tbody.find_all('tr')):
                cells = tr.find_all('td')
                if not cells:
                    continue
                
                row = [td.get_text(strip=True) for td in cells]
                table_data['rows'].append(row)
                
                if table_data['headers']:
                    record = {'_row_index': row_index}
                    for col_index, header in enumerate(table_data['headers']):
                        key = header or f'column_{col_index}'
                        record[key] = cells[col_index].get_text(strip=True) if col_index < len(cells) else ''
                    table_data['records'].append(record)
            
            if table_data['rows'] or table_data['headers']:
                page_data['tables'].append(table_data)
        
        for a_tag in soup.find_all('a', href=True):
            page_data['links'].append({
                'href': a_tag['href'],
                'text': a_tag.get_text(strip=True),
                'title': a_tag.get('title', '')
            })
        
        for img in soup.find_all('img'):
            page_data['images'].append({
                'src': img.get('src', ''),
                'alt': img.get('alt', ''),
                'title': img.get('title', '')
            })
        
        for label in soup.find_all('label'):
            label_text = label.get_text(strip=True).rstrip(':').strip()
            if not label_text:
                continue
            
            value_elem = label.find_next_sibling()
            while value_elem and value_elem.name == 'br':
                value_elem = value_elem.find_next_sibling()
            
            if value_elem and value_elem.name in ['div', 'span', 'p', 'td', 'dd', 'strong', 'b', 'em', 'i']:
                if not value_elem.find(['input', 'select', 'textarea']):
                    value_text = value_elem.get_text(strip=True)
                    if value_text:
                        page_data['label_values'][label_text] = value_text
            
            for_id = label.get('for')
            if for_id:
                target = soup.find(id=for_id)
                if target and target.name not in ['input', 'select', 'textarea']:
                    value_text = target.get_text(strip=True)
                    if value_text:
                        page_data['label_values'][label_text] = value_text
        
        for dt in soup.find_all('dt'):
            label_text = dt.get_text(strip=True).rstrip(':').strip()
            dd = dt.find_next_sibling('dd')
            if dd:
                value_text = dd.get_text(strip=True)
                if label_text and value_text:
                    page_data['label_values'][label_text] = value_text
        
        for tr in soup.find_all('tr'):
            cells = tr.find_all(['td', 'th'])
            if len(cells) == 2:
                first, second = cells
                if first.name == 'th' or first.find(['label', 'strong', 'b']):
                    label_text = first.get_text(strip=True).rstrip(':').strip()
                    if not second.find(['input', 'select', 'textarea']):
                        value_text = second.get_text(strip=True)
                        if label_text and value_text:
                            page_data['label_values'][label_text] = value_text
        
        return page_data
    
    def scrape_page(self, url: str) -> dict:
        url_hash = self.url_hash(url)
        
        if url_hash in self.visited_hashes or url in self.visited_urls:
            return None
        
        output_file = OUTPUT_DIR / f"{url_hash}.json"
        html_file = OUTPUT_DIR / f"{url_hash}.html"
        
        print(f"\n[{self.pages_scraped + 1}] Scraping:")
        print(f"    URL: {url}")
        print(f"    Hash: {url_hash}")
        print(f"    Output: {output_file}")
        
        try:
            print(f"    Requesting...")
            response = self.session.get(url, timeout=30, allow_redirects=True)
            print(f"    Status: {response.status_code}")
            response.raise_for_status()
            
            final_url = response.url.lower()
            if '/login' in final_url or '/requestpasswordreset' in final_url or '/signin' in final_url:
                print(f"\n{'!'*60}")
                print("ERROR: Redirected to login/password reset page!")
                print(f"Final URL: {response.url}")
                print("Your session cookie has expired. Please:")
                print("  1. Log in again in your browser")
                print("  2. Copy the new cookie to scripts/cookie.txt")
                print("  3. Delete migrate/_spider_state.json to start fresh")
                print("  4. Re-run the spider")
                print(f"{'!'*60}\n")
                self.save_state()
                sys.exit(1)
            
            self.visited_hashes.add(url_hash)
            self.pages_scraped += 1
            
            html = response.text
            soup = BeautifulSoup(html, 'lxml')
            
            page_data = self.extract_page_data(url, soup, html)
            page_data['status_code'] = response.status_code
            page_data['final_url'] = response.url
            
            new_links = self.extract_links(soup, url)
            for link in new_links:
                link_hash = self.url_hash(link)
                if link_hash not in self.visited_hashes and link not in self.queue:
                    self.queue.append(link)
            
            with open(output_file, 'w', encoding='utf-8') as f:
                json.dump(page_data, f, indent=2, ensure_ascii=False)
            
            with open(html_file, 'w', encoding='utf-8') as f:
                f.write(html)
            
            self.save_visited_url(url)
            
            print(f"    Saved: {output_file.name}, {html_file.name}")
            print(f"    Found {len(new_links)} links")
            
            return page_data
            
        except requests.RequestException as e:
            print(f"    ERROR: {e}")
            self.visited_hashes.add(url_hash)
            return {'url': url, 'error': str(e)}
    
    def run(self):
        print(f"\n{'='*60}")
        print(f"Site Migration Spider")
        print(f"{'='*60}")
        print(f"Seed URL: {self.seed_url}")
        print(f"Domain: {self.base_domain}")
        print(f"Auth Cookie: {'Set' if self.auth_cookie else 'Not set'}")
        print(f"Output: {OUTPUT_DIR}")
        print(f"Delay: {DELAY_SECONDS}s between requests")
        print(f"{'='*60}\n")
        
        self.queue.append(self.seed_url)
        
        try:
            while self.queue and self.pages_scraped < MAX_PAGES:
                url = self.queue.pop(0)
                result = self.scrape_page(url)
                
                if result:
                    self.save_state()
                    time.sleep(DELAY_SECONDS)
            
            print(f"\n{'='*60}")
            print(f"Spider Complete!")
            print(f"Pages scraped: {self.pages_scraped}")
            print(f"Output directory: {OUTPUT_DIR}")
            print(f"{'='*60}")
            
        except KeyboardInterrupt:
            print("\n\nInterrupted by user. State saved.")
            self.save_state()
        
        self.generate_manifest()
    
    def generate_manifest(self):
        manifest = {
            'generated_at': datetime.utcnow().isoformat(),
            'seed_url': self.seed_url,
            'base_domain': self.base_domain,
            'total_pages': self.pages_scraped,
            'pages': []
        }
        
        for json_file in OUTPUT_DIR.glob('*.json'):
            if json_file.name.startswith('_'):
                continue
            try:
                with open(json_file, 'r') as f:
                    data = json.load(f)
                manifest['pages'].append({
                    'hash': json_file.stem,
                    'url': data.get('url', ''),
                    'title': data.get('title', ''),
                    'scraped_at': data.get('scraped_at', '')
                })
            except:
                pass
        
        manifest_file = OUTPUT_DIR / '_manifest.json'
        with open(manifest_file, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)
        
        print(f"Manifest generated: {manifest_file}")


def load_cookie():
    cookie_file = SCRIPT_DIR.parent / 'cookie.txt'
    if cookie_file.exists():
        with open(cookie_file, 'r') as f:
            cookie = f.read().strip()
            if cookie:
                print(f"Loaded cookie from: {cookie_file}")
                return cookie
    auth_cookie = os.environ.get('AUTH_COOKIE', '')
    if auth_cookie:
        print("Using AUTH_COOKIE from environment")
    return auth_cookie


def main():
    parser = argparse.ArgumentParser(description='Site Migration Spider')
    parser.add_argument('seed_url', help='The starting URL to crawl')
    parser.add_argument('--delay', type=float, default=2.0, help='Delay between requests (seconds)')
    parser.add_argument('--max-pages', type=int, default=1000, help='Maximum pages to scrape')
    
    args = parser.parse_args()
    
    global DELAY_SECONDS, MAX_PAGES
    DELAY_SECONDS = args.delay
    MAX_PAGES = args.max_pages
    
    auth_cookie = load_cookie()
    
    spider = SiteMigrationSpider(args.seed_url, auth_cookie)
    spider.run()


if __name__ == '__main__':
    main()
