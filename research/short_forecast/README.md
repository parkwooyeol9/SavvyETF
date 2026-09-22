# Short-horizon forecast research

BTC-first walk-forward harness for the dashboard **단기예측** tab.

```bash
# from repo root
python3 -m venv .venv-sf
.venv-sf/bin/pip install numpy pandas scipy requests lightgbm
.venv-sf/bin/python research/short_forecast/btc_walkforward.py
```

Outputs: `out/btc_walkforward_results.json`

See Obsidian: `SavvyETF/01 화면/AI/단기예측 검증.md`
