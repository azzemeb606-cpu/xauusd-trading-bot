#!/usr/bin/env python3
"""
mt5_bridge.py — Lightweight HTTP REST Bridge for Local MetaTrader 5

Run this script on the same machine where MetaTrader 5 desktop is installed.
The Node.js backend connects to http://127.0.0.1:8000 (or LOCAL_MT5_URL).

Usage:
    pip install MetaTrader5
    python mt5_bridge.py [--port 8000] [--host 127.0.0.1]
"""

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import MetaTrader5 as mt5
    MT5_AVAILABLE = True
except ImportError:
    MT5_AVAILABLE = False
    print("WARNING: 'MetaTrader5' package not installed. Run 'pip install MetaTrader5'. Running in mock mode.")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("mt5_bridge")

class MT5Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress noisy standard request logs; log only errors
        pass

    def _send_json(self, status_code: int, data: dict):
        response = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Account-Key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(response)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def _read_json(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length).decode("utf-8")
        return json.loads(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path == "/health":
            self._send_json(200, {"status": "ok", "mt5_installed": MT5_AVAILABLE, "time": datetime.now(timezone.utc).isoformat()})
            return

        if not MT5_AVAILABLE:
            self._handle_mock_get(path, query)
            return

        if path == "/account":
            info = mt5.account_info()
            if info is None:
                self._send_json(500, {"ok": False, "message": f"account_info failed: {mt5.last_error()}"})
                return
            self._send_json(200, {
                "balance": info.balance,
                "equity": info.equity,
                "margin": info.margin,
                "freeMargin": info.margin_free,
                "marginLevel": info.margin_level,
                "currency": info.currency,
                "leverage": info.leverage,
                "name": info.name,
                "server": info.server,
                "company": info.company,
            })
            return

        if path == "/quote":
            symbol = query.get("symbol", ["XAUUSD"])[0]
            tick = mt5.symbol_info_tick(symbol)
            if tick is None:
                self._send_json(404, {"ok": False, "message": f"symbol_info_tick failed for {symbol}: {mt5.last_error()}"})
                return
            self._send_json(200, {
                "bid": tick.bid,
                "ask": tick.ask,
                "time": tick.time,
            })
            return

        if path == "/spec":
            symbol = query.get("symbol", ["XAUUSD"])[0]
            spec = mt5.symbol_info(symbol)
            if spec is None:
                self._send_json(404, {"ok": False, "message": f"symbol_info failed for {symbol}: {mt5.last_error()}"})
                return
            self._send_json(200, {
                "trade_contract_size": spec.trade_contract_size,
                "volume_min": spec.volume_min,
                "volume_max": spec.volume_max,
                "volume_step": spec.volume_step,
                "digits": spec.digits,
            })
            return

        if path == "/positions":
            symbol = query.get("symbol", [None])[0]
            positions = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
            if positions is None:
                self._send_json(200, [])
                return
            res = []
            for p in positions:
                res.append({
                    "ticket": p.ticket,
                    "symbol": p.symbol,
                    "type": "BUY" if p.type == 0 else "SELL",
                    "volume": p.volume,
                    "price_open": p.price_open,
                    "price_current": p.price_current,
                    "sl": p.sl,
                    "tp": p.tp,
                    "profit": p.profit,
                    "swap": p.swap,
                    "commission": getattr(p, "commission", 0.0),
                    "time": p.time,
                    "comment": p.comment,
                    "magic": p.magic,
                })
            self._send_json(200, res)
            return

        if path == "/orders":
            symbol = query.get("symbol", [None])[0]
            orders = mt5.orders_get(symbol=symbol) if symbol else mt5.orders_get()
            if orders is None:
                self._send_json(200, [])
                return
            res = []
            for o in orders:
                res.append({
                    "ticket": o.ticket,
                    "symbol": o.symbol,
                    "type": o.type,
                    "volume": o.volume_current,
                    "price_open": o.price_open,
                    "sl": o.sl,
                    "tp": o.tp,
                    "magic": o.magic,
                })
            self._send_json(200, res)
            return

        if path == "/deals":
            since_ts = int(query.get("since", [0])[0])
            from_dt = datetime.fromtimestamp(since_ts, tz=timezone.utc)
            to_dt = datetime.now(timezone.utc)
            deals = mt5.history_deals_get(from_dt, to_dt)
            if deals is None:
                self._send_json(200, [])
                return
            res = []
            for d in deals:
                if d.entry == 1: # ENTRY_OUT (closed deal)
                    res.append({
                        "ticket": d.ticket,
                        "position_id": d.position_id,
                        "symbol": d.symbol,
                        "type": d.type,
                        "volume": d.volume,
                        "price": d.price,
                        "profit": d.profit,
                        "swap": d.swap,
                        "commission": d.commission,
                        "reason": d.reason,
                        "time": d.time,
                    })
            self._send_json(200, res)
            return

        self._send_json(404, {"ok": False, "message": f"Route not found: {path}"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        try:
            body = self._read_json()
        except Exception as e:
            self._send_json(400, {"ok": False, "message": f"Invalid JSON: {e}"})
            return

        if path == "/connect":
            if not MT5_AVAILABLE:
                self._send_json(200, {"ok": True, "message": "Mock MT5 connected"})
                return
            login = body.get("login")
            password = body.get("password")
            server = body.get("server")
            symbol = body.get("symbol", "XAUUSD")

            if login and password and server:
                init_res = mt5.initialize(login=int(login), password=password, server=server)
            else:
                init_res = mt5.initialize()

            if not init_res:
                self._send_json(500, {"ok": False, "message": f"mt5.initialize failed: {mt5.last_error()}"})
                return

            mt5.symbol_select(symbol, True)
            self._send_json(200, {"ok": True, "message": f"MT5 connected to {symbol}"})
            return

        if not MT5_AVAILABLE:
            self._handle_mock_post(path, body)
            return

        if path == "/order":
            symbol = body.get("symbol", "XAUUSD")
            direction = body.get("direction", "BUY")
            kind = body.get("kind", "MARKET")
            volume = float(body.get("volume", 0.01))
            sl = float(body.get("sl", 0.0))
            tp = float(body.get("tp", 0.0))
            price = float(body.get("price", 0.0))
            comment = str(body.get("comment", "Bond007 Bot"))

            tick = mt5.symbol_info_tick(symbol)
            if not tick:
                self._send_json(400, {"ok": False, "message": f"Failed to get price for {symbol}"})
                return

            if kind == "MARKET":
                order_type = mt5.ORDER_TYPE_BUY if direction == "BUY" else mt5.ORDER_TYPE_SELL
                exec_price = tick.ask if direction == "BUY" else tick.bid
                action = mt5.TRADE_ACTION_DEAL
            else:
                order_type = mt5.ORDER_TYPE_BUY_LIMIT if direction == "BUY" else mt5.ORDER_TYPE_SELL_LIMIT
                exec_price = price
                action = mt5.TRADE_ACTION_PENDING

            request = {
                "action": action,
                "symbol": symbol,
                "volume": volume,
                "type": order_type,
                "price": exec_price,
                "sl": sl,
                "tp": tp,
                "deviation": 20,
                "magic": 7007,
                "comment": comment,
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }

            result = mt5.order_send(request)
            if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
                retcode = getattr(result, "retcode", -1)
                comment = getattr(result, "comment", str(mt5.last_error()))
                self._send_json(400, {"ok": False, "code": str(retcode), "message": f"order_send failed: {comment}"})
                return

            self._send_json(200, {
                "ok": True,
                "orderId": str(result.order),
                "positionId": str(result.order),
                "code": "TRADE_RETCODE_DONE",
                "message": "Order executed successfully",
            })
            return

        if path == "/position/modify":
            ticket = int(body.get("ticket"))
            sl = float(body.get("sl", 0.0))
            tp = float(body.get("tp", 0.0))

            req = {
                "action": mt5.TRADE_ACTION_SLTP,
                "position": ticket,
                "sl": sl,
                "tp": tp,
            }
            res = mt5.order_send(req)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                self._send_json(400, {"ok": False, "message": f"Modify failed: {getattr(res, 'comment', mt5.last_error())}"})
                return
            self._send_json(200, {"ok": True, "message": "Position modified"})
            return

        if path == "/position/close":
            ticket = int(body.get("ticket"))
            volume = body.get("volume")
            positions = mt5.positions_get(ticket=ticket)
            if not positions:
                self._send_json(404, {"ok": False, "message": f"Position #{ticket} not found"})
                return

            pos = positions[0]
            close_vol = float(volume) if volume and float(volume) < pos.volume else pos.volume
            order_type = mt5.ORDER_TYPE_SELL if pos.type == 0 else mt5.ORDER_TYPE_BUY
            tick = mt5.symbol_info_tick(pos.symbol)
            price = tick.bid if pos.type == 0 else tick.ask

            req = {
                "action": mt5.TRADE_ACTION_DEAL,
                "position": ticket,
                "symbol": pos.symbol,
                "volume": close_vol,
                "type": order_type,
                "price": price,
                "deviation": 20,
                "magic": 7007,
                "comment": "Bond007 Close",
                "type_time": mt5.ORDER_TIME_GTC,
                "type_filling": mt5.ORDER_FILLING_IOC,
            }
            res = mt5.order_send(req)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                self._send_json(400, {"ok": False, "message": f"Close failed: {getattr(res, 'comment', mt5.last_error())}"})
                return
            self._send_json(200, {"ok": True, "message": "Position closed"})
            return

        if path == "/order/cancel":
            ticket = int(body.get("ticket"))
            req = {
                "action": mt5.TRADE_ACTION_REMOVE,
                "order": ticket,
            }
            res = mt5.order_send(req)
            if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
                self._send_json(400, {"ok": False, "message": f"Cancel failed: {getattr(res, 'comment', mt5.last_error())}"})
                return
            self._send_json(200, {"ok": True, "message": "Order cancelled"})
            return

        self._send_json(404, {"ok": False, "message": f"Route not found: {path}"})

    def _handle_mock_get(self, path, query):
        if path == "/account":
            self._send_json(200, {
                "balance": 10000.0, "equity": 10000.0, "margin": 0.0, "freeMargin": 10000.0,
                "marginLevel": None, "currency": "USD", "leverage": 100, "name": "Mock MT5 Account",
                "server": "DemoServer", "company": "Mock Broker"
            })
        elif path == "/quote":
            self._send_json(200, {"bid": 2735.50, "ask": 2735.75, "time": int(datetime.now().timestamp())})
        elif path == "/spec":
            self._send_json(200, {"trade_contract_size": 100, "volume_min": 0.01, "volume_max": 50.0, "volume_step": 0.01, "digits": 2})
        elif path in ("/positions", "/orders", "/deals"):
            self._send_json(200, [])
        else:
            self._send_json(404, {"ok": False, "message": "Not found"})

    def _handle_mock_post(self, path, body):
        self._send_json(200, {"ok": True, "orderId": "MOCK12345", "positionId": "MOCK12345", "message": "Mock action done"})

def main():
    parser = argparse.ArgumentParser(description="MT5 Local HTTP REST Bridge")
    parser.add_argument("--host", default="127.0.0.1", help="Binding host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Binding port (default: 8000)")
    args = parser.parse_args()

    server = HTTPServer((args.host, args.port), MT5Handler)
    logger.info(f"MT5 Bridge Server running on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    finally:
        if MT5_AVAILABLE:
            mt5.shutdown()

if __name__ == "__main__":
    main()
