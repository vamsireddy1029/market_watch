# contract_utils.py

import os
import re
import requests
import pandas as pd
from datetime import datetime, timedelta, timezone


# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES_DIR = os.path.join(BASE_DIR, 'files')

CONTRACT_TXT_PATH = os.path.join(FILES_DIR, 'contract.txt')

def download_sos_csv(save_path="NSE_FO_SosScheme.csv"):
    url = "https://nsearchives.nseindia.com/content/fo/NSE_FO_SosScheme.csv"
    headers = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.nseindia.com"}

    session = requests.Session()
    session.headers.update(headers)
    session.get("https://www.nseindia.com")  # Initial request to set cookies
    response = session.get(url)

    if response.ok:
        with open(save_path, "wb") as f:
            f.write(response.content)
        print(f"Downloaded CSV to {save_path}")
    else:
        raise Exception("Download failed.")

def epoch_to_custom_date(epoch):
    base_date = datetime(1980, 1, 1, tzinfo=timezone.utc)
    date_obj = base_date + timedelta(seconds=int(epoch))
    return date_obj.strftime('%d%b%Y')

# === Read contract.txt Contracts ===
def read_contract_file(file_path=CONTRACT_TXT_PATH):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")
    contract_data = []
    with open(file_path, 'r', encoding="utf-8") as f:
        next(f)
        for line in f:
            parts = line.strip().split('|')
            if len(parts) == 69:
                token = parts[0]
                symboll = parts[3]
                expiry_date = epoch_to_custom_date(parts[6])
                strike = round(float(parts[7]) / 100, 2)
                option_type = parts[8]
                cp = round(float(parts[67]) / 100, 2)
                lot_size = parts[30]
                if option_type == 'XX':
                    option_type = 'FUT'
                contract_data.append({
                    'token': token,
                    'symboll': symboll.strip(),
                    'expiry_date': expiry_date.strip(),
                    'strike': strike,
                    'type': option_type.strip(),
                    'Closing_price': cp,
                    'lot_size': lot_size
                })
    return pd.DataFrame(contract_data)