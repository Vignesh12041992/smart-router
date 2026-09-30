# Smart LLM Task Router

An automated, non-generative routing system that maps incoming text prompts to specialized backend models using **Laya's System-1 decision framework**. It computes semantic classification match percentages and complexity rankings concurrently in a single forward pass without triggering high-latency text generation.

## Prerequisites

- **Node.js**: Version 20.0.0 or higher is required.
- **Hardware/Memory**: Ensure at least 2.5 GB of free system RAM is available to cache and map the ~1.7 GB ONNX runtime weights file natively.

## Local Installation

1. Clone or navigate to your local root directory:
   ```bash
   cd smart-router
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running the Application

Execute the automated local profiling suite:
```bash
npm start
```

*Note: On your first application launch, the tool automatically downloads the `laya` foundational decision model from Hugging Face and saves it locally inside `~/.cache/receptron-laya`. Subsequent initializations complete within seconds.*

## System Parameters Explained
- **Complexity Score**: Evaluated continuously from `0.0` (trivial interactions) to `3.0` (deep analytical architectures).
- **Match Confidence**: The mathematical accuracy threshold generated dynamically via Laya's classification logic layers.
