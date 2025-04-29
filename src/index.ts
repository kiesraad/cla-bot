import { getInput, setOutput } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import type { components } from "@octokit/openapi-types";
import yaml from "js-yaml";

if (!context.payload.pull_request) {
	throw new Error("No pull request context available");
}

// "base" so we retrieve the contributors file from the receiving repo,
// not from the submitting one, which can be a fork we don't own
const contributorsRepositoryOwner =
	getInput("contributors-repository-owner") ||
	context.payload.pull_request["base"]["repo"]["owner"]["login"];
const contributorsRepositoryName =
	getInput("contributors-repository-name") ||
	context.payload.pull_request["base"]["repo"]["name"];
const contributorsFile = getInput("contributors-file");
const githubToken = getInput("github-token");
const octokit = getOctokit(githubToken);

const commits = await octokit.rest.pulls.listCommits({
	owner: context.repo.owner,
	repo: context.repo.repo,
	pull_number: context.payload.pull_request.number,
});

const missingAuthors = commits.data.filter((commit) => !commit.author?.login);

if (missingAuthors.length > 0) {
	throw new Error(`PR contains commits without associated GitHub users`);
}

const authors = Array.from(
	new Set(
		commits.data
			.filter((commit) => commit.author!.type.toLowerCase() !== "bot")
			.map((commit) => commit.author!.login),
	),
).sort();

console.log(`authors: ${authors}`);

const fileContentResponse = await octokit.rest.repos.getContent({
	owner: contributorsRepositoryOwner,
	repo: contributorsRepositoryName,
	path: contributorsFile,
	ref: "refs/heads/main",
});

const contributors = (yaml.load(
	Buffer.from(
		(fileContentResponse.data as components["schemas"]["content-file"]).content,
		"base64",
	).toString(),
) ?? []) as string[];

console.log(`contributors: ${contributors}`);

const missing = authors.filter(
	(author) => contributors.includes(author) === false,
);

if (missing.length > 0) {
	console.log(
		`Not all contributors have signed the CLA. Missing: ${missing.join(", ")}`,
	);

	setOutput("missing", missing.map((login) => `@${login}`).join(", "));

	process.exit(1);
}
