pipeline {
    // 指定运行在名为 'listify-test' 的 SSH 节点上
    agent { label 'listify-test' }

    environment {
        // 根据你指定的项目名
        COMPOSE_PROJECT_NAME = 'fusiongo-distribution-platform'
    }

    stages {
        stage('Checkout') {
            steps {
                // 在 SSH 服务器上拉取代码
                checkout scm
            }
        }

        stage('Deploy with Docker Compose') {
            steps {
                script {
                    echo "正在远程 SSH 服务器上执行部署..."

                    // 打印当前目录，方便排错
                    sh "pwd"
                    sh "ls -al"

                    // 前置校验：docker-compose.yml 已通过 env_file 引用 .env，
                    // 必须先在部署机项目目录创建 .env（含 FCG_MODE、FCG_APP_KEY、FCG_APP_SECRET 等），
                    // 否则 compose 启动时会因缺少 env_file 直接失败
                    if (!fileExists('.env')) {
                        error """\
【部署中止】当前目录未找到 .env 文件。
docker-compose.yml 已通过 env_file: - .env 注入 FCG 凭证，请先在部署机项目根目录创建 .env：
  FCG_MODE=sandbox
  FCG_ENV=sandbox
  FCG_BASE_URL=https://open.fusionconnectgroup.com
  FCG_APP_KEY=<平台颁发的沙箱 AppKey>
  FCG_APP_SECRET=<平台颁发的沙箱 AppSecret>
  FCG_SANDBOX_HOTEL_SIMULATION=false
  PII_ENCRYPTION_KEY=<32位以上随机字符串>
  PORT=8787
  DATABASE_PATH=/data/fusiongo-sandbox.sqlite
.env 已被 .gitignore / .dockerignore 排除，不会进入仓库或镜像。"""
                    }

                    echo "✅ .env 已就绪，开始部署"

                    // 使用你指定的 V2 版命令格式：docker compose (中间是空格)
                    sh "docker compose -p ${COMPOSE_PROJECT_NAME} down || true"
                    sh "docker compose -p ${COMPOSE_PROJECT_NAME} up -d --build"
                }
            }
        }
    }
    
    post {
        success {
            echo "✅ 构建并部署成功！服务已启动。"
        }
        failure {
            echo "❌ 构建或部署失败，请检查 SSH 服务器上的 Jenkins 日志。"
        }
    }
}