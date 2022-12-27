import { execSync } from "child_process";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { program } from "commander";

dotenv.config();

interface DeployConfig {
  configPath: string;
  subgraphName: string;
  versionLabel: string;
  endpoint: string;
  ipfsEndpoint: string;
}

/**
 * Execute Child Processes
 * @param cmd Command to execute
 * @returns The command ran it
 */
const exec = (cmd: string): string | Buffer => {
  const srcDir = path.join(__dirname, "..");
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};

/**
 * Write a file
 * @param _path Location of the file
 * @param file The file
 */
// eslint-disable-next-line
const writeFile = (_path: string, file: any): void => {
  try {
    fs.writeFileSync(_path, file);
  } catch (error) {
    console.log(error);
  }
};

/**
 * Check the endpoint where the subgraph will be deployed. If default is used, will return TheGraph endpoint
 * `https://api.thegraph.com/deploy/`. In other case, user should check the endpoint and function just will
 * check the slash at the end of the endpoint
 * @param endpoint The desired endpoint. Set `default` is want to use the TheGraph endpoint.
 * @returns The checked endpoint
 */
const checkEndpoint = (endpoint: string): string => {
  if (endpoint === "default" || "") {
    return "--node https://api.thegraph.com/deploy/";
  } else {
    return `--node ${endpoint.slice(-1) === "/" ? endpoint : endpoint + "/"}`;
  }
};

const checkIpfsEndpoint = (endpoint: string): string => {
  if (endpoint === "default" || endpoint === "") {
    return "";
  } else {
    return `--ipfs ${endpoint}`;
  }
};

const createLabel = (label: string): string => {
  if (label === "default" || label === "") {
    return "";
  } else {
    return `--version-label ${label}`;
  }
};

const main = async () => {
  program
    .requiredOption(
      "--config <string>",
      "Path to JSON file with the addresess and chain to deploy."
    )
    .requiredOption(
      "--subgraphName <string>",
      "The subgraph name to deploy. Eg: 'user/name'."
    )
    .option(
      "--versionLabel <string>",
      "The subgraph version label that will be append.",
      ""
    )
    .option(
      "--endpoint <string>",
      "The URL that will be use to deploy the subgraph.",
      "https://api.thegraph.com/deploy/"
    )
    .option(
      "--ipfsEndpoint <string>",
      "The URL that will be use with IPFS.",
      ""
    )
    .option(
      "--subgraphTemplate <string>",
      "Specify a path to a another differente yaml file to be used as template. By the default use the root template.",
      "subgraph.template.yaml"
    );

  program.parse();
  const options = program.opts();

  const _config = options.config;
  const _subgraphName = options.subgraphName;
  const _endpoint = checkEndpoint(options.endpoint);
  const _ipfsEndpoint = checkIpfsEndpoint(options.ipfsEndpoint);
  const _versionLabel = createLabel(options.versionLabel);
  const _subgraphTemplate = options.subgraphTemplate;

  // Add the address to the subgraph.yaml file
  exec(`npx mustache ${_config} ${_subgraphTemplate} subgraph.yaml`);

  // Generate all teh SG code
  exec("npm run generate-schema && npm run codegen && npm run build");

  // This create the graph node with the endpoint and subgraph name to be used locally
  if (_endpoint.includes("localhost") || _endpoint.includes("127.0.0.1")) {
    exec(`npx graph create ${_endpoint} ${_subgraphName}`);
  }

  // Deploy the Subgraph
  exec(
    `npx graph deploy --studio demi-subgraph-factory ${_ipfsEndpoint} ${_versionLabel}`
  );
};

main()
  .then(() => {
    const exit = process.exit;
    exit(0);
  })
  .catch((error) => {
    console.error(error);
    const exit = process.exit;
    exit(1);
  });
