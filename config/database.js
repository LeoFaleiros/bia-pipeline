const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { fromIni, fromEnv } = require("@aws-sdk/credential-providers");
const { STSClient, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");

async function isLocalConnection() {
  const dbHost = process.env.DB_HOST;
  return (
    !dbHost ||
    dbHost === "database" ||
    dbHost === "127.0.0.1" ||
    dbHost === "localhost"
  );
}

async function getRemoteDialectOptions() {
  return {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  };
}

async function getConfig() {
  const isLocal = await isLocalConnection();

  let dbConfig = {
    username: process.env.DB_USER || "postgres",
    password: process.env.DB_PWD || "postgres",
    database: process.env.DB_NAME || "bia",
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT) || 5432,
    dialect: "postgres",
    dialectOptions: isLocal ? {} : await getRemoteDialectOptions(),
  };

  if (process.env.DB_SECRET_NAME && process.env.DB_SECRET_NAME.trim() !== "") {
    const secretsManagerClient = await createSecretsManagerClient();
    const secrets = await getSecrets(secretsManagerClient);

    if (secrets) {
      dbConfig.username = secrets.username;
      dbConfig.password = secrets.password;
      await imprimirSecrets(secrets);
    }
  }

  console.log("🟡 DB Config usado pela Lambda:", dbConfig); // Log para debug

  return dbConfig;
}

async function createSecretsManagerClient() {
  let credentials;

  if (process.env.IS_LOCAL === "true") {
    credentials = fromEnv();
    // credentials = fromIni({ profile: "SEU_PROFILE" });
  }

  if (process.env.DB_SECRET_NAME) {
    const client = new SecretsManagerClient({
      region: process.env.DB_REGION,
      credentials,
    });

    if (process.env.DEBUG_SECRET === "true") {
      const stsClient = new STSClient({
        region: process.env.DB_REGION,
        credentials,
      });

      try {
        const identity = await stsClient.send(new GetCallerIdentityCommand({}));
        console.log("Credenciais carregadas com sucesso:", identity);
        console.log("Account ID:", identity.Account);
      } catch (error) {
        console.error("Erro ao carregar credenciais:", error);
      }
    }

    return client;
  } else {
    console.log("DB_SECRET_NAME não está definida.");
    return null;
  }
}

async function getSecrets(secretsManagerClient) {
  try {
    if (!secretsManagerClient) {
      console.error("O cliente do Secrets Manager não foi instanciado.");
      return;
    }

    console.log(`🔐 Buscando secrets: ${process.env.DB_SECRET_NAME}`);

    const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_NAME });
    const data = await secretsManagerClient.send(command);

    if ("SecretString" in data) {
      return JSON.parse(data.SecretString);
    } else {
      return Buffer.from(data.SecretBinary, "base64");
    }
  } catch (err) {
    console.error("Erro ao recuperar as credenciais do Secrets Manager:", err);
    throw err;
  }
}

async function imprimirSecrets(secrets) {
  if (process.env.DEBUG_SECRET === "true") {
    console.log("🔐 Secrets retornados:", secrets);
  }
}

module.exports = getConfig;
