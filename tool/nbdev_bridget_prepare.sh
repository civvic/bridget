#!/bin/bash

echo "🔧 Bridget preparation workflow (skipping tests)..."
echo ""

echo "1️⃣ Exporting notebooks to Python modules..."
nbdev_export
if [ $? -ne 0 ]; then
    echo "❌ Export failed"
    exit 1
fi

echo ""
echo "2️⃣ Cleaning notebook metadata..."
nbdev_clean
if [ $? -ne 0 ]; then
    echo "❌ Clean failed"
    exit 1
fi

echo ""
echo "3️⃣ Updating README from index.ipynb..."
nbdev_readme
if [ $? -ne 0 ]; then
    echo "❌ README generation failed"
    exit 1
fi

echo ""
echo "✅ Bridget preparation complete!"
echo ""
echo "📝 Note: Tests skipped (run notebooks interactively to test)"
echo ""
echo "Next steps:"
echo "  - Run: nbdev_docs (to generate documentation)"
echo "  - Run: ./tool/refresh_llm_docs.sh (to update LLM docs)"
