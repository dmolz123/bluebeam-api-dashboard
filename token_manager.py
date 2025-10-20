# token_manager.py
import sqlite3
import time
import requests
import os
from base64 import b64encode

class TokenManager:
    def __init__(self, db_path='tokens.db'):
        self.db_path = db_path
        self.client_id = os.getenv('BLUEBEAM_CLIENT_ID')
        self.client_secret = os.getenv('BLUEBEAM_CLIENT_SECRET')
        self._init_db()
    
    def _init_db(self):
        """Create the database table if it doesn't exist"""
        conn = sqlite3.connect(self.db_path)
        conn.execute('''
            CREATE TABLE IF NOT EXISTS tokens (
                id INTEGER PRIMARY KEY,
                refresh_token TEXT,
                access_token TEXT,
                expires_at INTEGER
            )
        ''')
        conn.commit()
        conn.close()
    
    def save_tokens(self, access_token, refresh_token, expires_in):
        """Save both access and refresh tokens to database"""
        expires_at = int(time.time()) + expires_in
        
        conn = sqlite3.connect(self.db_path)
        conn.execute('DELETE FROM tokens')  # Clear old tokens
        conn.execute(
            'INSERT INTO tokens (refresh_token, access_token, expires_at) VALUES (?, ?, ?)',
            (refresh_token, access_token, expires_at)
        )
        conn.commit()
        conn.close()
    
    def get_tokens(self):
        """Get tokens from database"""
        conn = sqlite3.connect(self.db_path)
        result = conn.execute(
            'SELECT access_token, refresh_token, expires_at FROM tokens LIMIT 1'
        ).fetchone()
        conn.close()
        
        if result:
            return {
                'access_token': result[0],
                'refresh_token': result[1],
                'expires_at': result[2]
            }
        return None
    
    def refresh_access_token(self, refresh_token):
        """Use refresh token to get new access token"""
        # Create Basic Auth header
        credentials = f"{self.client_id}:{self.client_secret}"
        encoded_credentials = b64encode(credentials.encode()).decode()
        
        response = requests.post(
            'https://api.bluebeam.com/oauth2/token',
            headers={
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': f'Basic {encoded_credentials}'
            },
            data={
                'grant_type': 'refresh_token',
                'refresh_token': refresh_token
            }
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Failed to refresh token: {response.text}")
    
    def get_valid_access_token(self):
        """Get a valid access token, refreshing if necessary"""
        tokens = self.get_tokens()
        
        # If no tokens exist, need initial setup
        if not tokens:
            # Try to get initial refresh token from env variable
            initial_refresh_token = os.getenv('BLUEBEAM_REFRESH_TOKEN')
            if not initial_refresh_token:
                raise Exception("No tokens in database and no BLUEBEAM_REFRESH_TOKEN in environment")
            
            # Use it to get new tokens
            new_tokens = self.refresh_access_token(initial_refresh_token)
            self.save_tokens(
                new_tokens['access_token'],
                new_tokens['refresh_token'],
                new_tokens['expires_in']
            )
            return new_tokens['access_token']
        
        # Check if access token is still valid (with 5 min buffer)
        if tokens['expires_at'] > time.time() + 300:
            return tokens['access_token']
        
        # Token expired, refresh it
        new_tokens = self.refresh_access_token(tokens['refresh_token'])
        self.save_tokens(
            new_tokens['access_token'],
            new_tokens['refresh_token'],
            new_tokens['expires_in']
        )
        return new_tokens['access_token']
