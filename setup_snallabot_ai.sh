set -euxo pipefail
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env
uv python install 3.10
uv venv llm
source llm/bin/activate
uv pip install llama-stack
llama download --source meta --model-id Llama3.1-8B-Instruct
mkdir repos
cd repos
git clone https://github.com/meta-llama/llama-models.git
cd llama-models
uv pip install ".[torch]"
