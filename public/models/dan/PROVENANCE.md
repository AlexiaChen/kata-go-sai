# Model provenance

- Network: `kata1-b10c128-s1141046784-d204142634`
- Architecture: KataGo 10-block, 128-channel network
- Browser format: TensorFlow.js GraphModel, converted with TensorFlow.js Converter 3.18.0
- Copied from the sibling reference repository `../go/model/dan/`
- Reference repository commit: `918378c1fe1f1b9eba8dc704eb3de0c7651c819e`
- Official network listing: https://katagotraining.org/networks/
- Official neural-network license: https://katagotraining.org/network_license/

The graph accepts `bin_inputs` with shape `[batch, 361, 22]` and
`global_inputs` with shape `[batch, 19]`. Its weights are split across three
binary shards totaling approximately 11.4 MB.

## SHA-256

- `model.json`: `adbacd7ab022cf6bd79a2a59138f92b6ccb23a6f2787ceccb2a8f3d5a0d50dc0`
- `group1-shard1of3.bin`: `dc2b5afd58aac241bbb171cbe7e62011362a4cd56acf656380c81e4da7d7b1fd`
- `group1-shard2of3.bin`: `aa670c786d57cb37028d4e4150cb8f30fbb160ffb209bde75d2127265da3227a`
- `group1-shard3of3.bin`: `4dae0b6d80ab4cf935ca0a2893641bf8f8b771d8db97ede44b97b53d058f4db9`
