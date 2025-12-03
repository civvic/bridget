# Bridget Development Tools

## Scripts

### nbdev_bridget_prepare.sh
Custom preparation workflow that skips automated testing (which doesn't work for interactive-only code).

**Usage:**
```bash
./tool/nbdev_bridget_prepare.sh
```

**What it does:**
1. Exports notebooks to Python modules (`nbdev_export`)
2. Cleans notebook metadata (`nbdev_clean`)
3. Updates README from index.ipynb (`nbdev_readme`)

**Note:** Skips `nbdev_test` because Bridget requires a real Jupyter kernel to run.

### refresh_llm_docs.sh
Regenerates LLM-friendly documentation files.

**Usage:**
```bash
./tool/refresh_llm_docs.sh
```

**What it does:**
1. Generates API list using `pysym2md`
2. Creates `llms-ctx.txt` (core docs)
3. Creates `llms-ctx-full.txt` (complete docs with optional sections)

**Requirements:**
```bash
pip install llms-txt
pip install git+https://github.com/AnswerDotAI/pysymbol-llm.git
```
