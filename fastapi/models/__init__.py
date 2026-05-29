"""
models/ — local ML model runtime + classifier abstractions.

We deliberately do NOT bundle a model file. The runtime here is the
interface and the load-on-demand glue; operators ship their own ONNX
artifact at the path given by LOCAL_CLASSIFIER_MODEL_PATH.

Why bother
  • Full LLM-provider outage is a real risk (multiple Anthropic outages
    in 2025, Gemini quota incidents). A local classifier gives the
    pipeline a non-zero answer even when every cloud LLM is down.
  • Even when LLMs are up, the local top-k can SEED the LLM prompt as a
    prior ("CV suggests: Early Blight 0.72, Late Blight 0.18, …"), which
    measurably reduces hallucinated disease names in eval.

Suggested model
  PlantVillage MobileNetV2 ONNX — ~30 MB, 38 disease classes across 14
  crops. Many open-source mirrors. Convert from the standard Keras/PyTorch
  weights with torch.onnx.export(model, dummy, "plant_village_mbnet.onnx").
  Drop the file in /opt/cropguard/models/ (or wherever) and set
  LOCAL_CLASSIFIER_MODEL_PATH=/opt/cropguard/models/plant_village_mbnet.onnx.
"""
