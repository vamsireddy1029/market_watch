# contract_utils.py

import os
import re
import requests
import pandas as pd
from datetime import datetime

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES_DIR = os.path.join(BASE_DIR, 'files')
DB_PATH = os.path.join(BASE_DIR, 'market_data.db')

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

def get_latest_contract_file(directory=FILES_DIR):
    pattern = r'^EQD_CO(\d{6})\.csv$'
    latest_date = None
    latest_file = None

    for file_name in os.listdir(directory):
        match = re.match(pattern, file_name)
        if match:
            date_str = match.group(1)
            try:
                file_date = datetime.strptime(date_str, '%d%m%y')
                if latest_date is None or file_date > latest_date:
                    latest_date = file_date
                    latest_file = file_name
            except ValueError:
                continue

    if latest_file:
        return os.path.join(directory, latest_file)
    else:
        raise FileNotFoundError("No valid EQD_CO*.csv file found in directory.")

def read_contract_file(file_path):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    contract_data = []
    with open(file_path, 'r', encoding="utf-8") as f:
        next(f)  # Skip header
        for line in f:
            parts = line.strip().split(',')
            if len(parts) >= 69:
                symbol_type = parts[2].strip()
                if symbol_type not in ('IO', 'IF'):
                    continue

                token = parts[0].strip()
                symboll = parts[3].strip()
                raw_expiry = parts[6].strip()
                expiry_date = raw_expiry.replace('-', '')
                strike = round(float(parts[7]) / 100, 2)
                option_type = parts[8].strip() or 'FUT'

                contract_data.append({
                    'token': token,
                    'symboll': symboll,
                    'expiry_date': expiry_date,
                    'strike': strike,
                    'type': option_type,
                })

    return pd.DataFrame(contract_data)


