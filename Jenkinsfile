pipeline {
    agent any
    environment { ... }
    stages {
        stage('Checkout') {
            steps {
                checkout scm // 这一步现在可以工作了，因为下文把SCM源配置好了
            }
        }
        stage('Deploy') { ... }
    }
}