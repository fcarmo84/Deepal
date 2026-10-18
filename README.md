# Carga Barata

Planeador pessoal de carregamentos para o Changan Deepal S07 com Atlante Go. Escolhe origem e destino, e a app sugere onde parar e até que percentagem carregar para gastar menos. As contas incluem os Green Gems, as pausas para descansar, a refeição e a curva de carregamento real do carro.

## Como funciona

- **Rota**: calculada no momento pelo serviço público [OSRM](https://project-osrm.org), com até 2 alternativas.
- **Postos em Portugal**: dados oficiais NAP MOBI.E, atualizados todas as semanas por uma GitHub Action (`scripts/update_pt.py`) a partir do projeto [nap-dashboard](https://github.com/CarregaErvilhas/nap-dashboard) / [nap.ocarroeletrico.com](https://nap.ocarroeletrico.com/).
- **Postos em Espanha**: lista curta manual em `data/es-stations.json`. Com uma chave gratuita do [Open Charge Map](https://openchargemap.org/site/develop/api) (colada nas definições da app), procura todos os postos rápidos reais ao longo da rota.
- **Pesquisa de locais**: [Nominatim](https://nominatim.org) (OpenStreetMap).
- **Otimização**: programação dinâmica sobre (paragem, nº de paragens, refeição, % de bateria). Minimiza o custo real mais o valor que dás a cada hora extra.

A casa, as definições e a chave do Open Charge Map ficam guardadas só no navegador do telemóvel (localStorage). Nada disso está neste repositório.

## Publicar

Settings → Pages → Source: **GitHub Actions**. O workflow `publicar.yml` publica a cada alteração e todas as terças atualiza os postos.

Para atualizar os postos à mão: Actions → "Atualizar postos e publicar" → Run workflow.

## Créditos e licenças

Uso pessoal, sem fins comerciais.

- Dados NAP MOBI.E: uso livre com menção da fonte, sem fins lucrativos.
- nap-dashboard: código PolyForm Noncommercial 1.0.0; daqui só se lê o ficheiro de dados que publica.
- Mapa e pesquisa: © contribuidores do OpenStreetMap (ODbL). Rotas: OSRM.
- Curva de carregamento do Deepal S07: EVKX (estimada).
