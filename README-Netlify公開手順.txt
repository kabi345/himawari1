かびるんるんブラウザ（Netlify用・ゲーム分離版）

このZIPはNetlifyに公開するブラウザ側の一式です。

内容：
- index.html：ゲーム機能を取り除いたブラウザ画面
- netlify/functions/：ログイン、チャット、検索、ページ表示に必要なFunctions
- netlify.toml：公開フォルダとFunctionsの設定
- package.json：Netlify Blobs依存関係

公開手順：
1. まず、現在Netlifyに公開しているサイトの状態を確認してください。
2. このZIPを展開し、中身のファイル・フォルダを一式そのままNetlifyの同じサイトに手動デプロイしてください。
3. index.htmlだけを単独でアップロードしないでください。netlifyフォルダ、netlify.toml、package.jsonも必要です。
4. 新しいサイトを作らず、今まで使っていた同じNetlifyサイトへデプロイしてください。

注意：
- このZIPにはゲーム画面と game API Function は含まれていません。ゲームは別のオフラインHTMLです。
- ログイン・チャット等のデータを保存しているNetlify Blobsストア自体を操作・削除するファイルは含めていません。
- 念のため、デプロイ前に既存データのバックアップを残してください。
- デプロイ後は、トップページ、ログイン、検索、チャットを確認してください。
