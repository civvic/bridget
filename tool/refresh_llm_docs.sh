#!/bin/bash

echo "Refreshing LLM documentation files..."

cd nbs || exit 1

echo "Generating API list documentation..."
pysym2md bridget --output_file apilist.txt

echo "Generating context files..."
llms_txt2ctx llms.txt > llms-ctx.txt
llms_txt2ctx llms.txt --optional True > llms-ctx-full.txt

cd ..

echo "✅ Documentation refresh complete!"
