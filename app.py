"""
app.py
TrashPanda — GitHub PAT validator and repository explorer.
Run: python app.py
"""

import sys
import os

# Ensure the project root is on sys.path so `api` and `core` packages resolve
# correctly regardless of how/where the script is invoked.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from flask import Flask, render_template
from flask_cors import CORS
from api.routes import bp as api_bp

def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    CORS(app)
    app.register_blueprint(api_bp)

    @app.route("/")
    def index():
        return render_template("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    # Bind to 0.0.0.0 so WSL port is reachable from Windows browser
    app.run(host="0.0.0.0", port=5000, debug=True)
