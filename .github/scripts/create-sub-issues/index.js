// @ts-check

/**
 * @typedef {ReturnType<import('@actions/github').getOctokit>} GitHub
 * @typedef {typeof import('@actions/github').context} Context
 *
 * @param {GitHub} github
 * @param {Context} context
 * @param {Record<string, string>} env
 * @returns {Promise<void>}
 */
async function main(github, context, env) {
  const { owner, repo } = getOwnerAndRepo(context, env);
  const issueNumber = getIntegerFromEnv(env, 'ISSUE_NUMBER');
  try {
    const projectNumber = getIntegerFromEnv(env, 'PROJECT_NUMBER');
    const repository = await getRepository(github, { owner, repo, issueNumber, projectNumber });
    const issuesInProject = await getIssuesInProject(github, { owner, repo, projectNumber });
    const issuesInProjectByTitle = new Map(issuesInProject.map(issue => [issue.title, issue]));
    const subtasks = parseSubtasks(repository.issue.body).filter(subtask => subtask.checked);
    console.info(`Creating ${subtasks.length} subtask issues.`);
    const results = await Promise.allSettled(subtasks.map(async (subtask) => {
      const subIssueTitle = buildSubIssueTitle(subtask.titlePrefix, repository.issue.title);
      const existingIssue = issuesInProjectByTitle.get(subIssueTitle);
      if (existingIssue) {
        console.warn(`The issue named "${subIssueTitle}" already exists at #${existingIssue.number}.`);
        return;
      }
      const newIssue = await createIssue(github, {
        repositoryId: repository.id,
        title: subIssueTitle,
        body: '',
        labelIds: [repository.caseEntryLabel.id],
        parentIssueId: repository.issue.id,
      });
      console.info(`Created sub-issue "${subIssueTitle}" at #${newIssue.number}.`);
      const projectItem = await addIssueToProject(github, { projectId: repository.projectV2.id, issueId: newIssue.id });
      console.info(`Added sub-issue "${subIssueTitle}" to project "${repository.projectV2.title}".`);
      await updateProjectItemFieldValue(github, {
        projectId: repository.projectV2.id,
        itemId: projectItem.id,
        fieldId: repository.projectV2.statusField.id,
        value: { singleSelectOptionId: repository.projectV2.statusField.options[0].id },
      });
      console.info(`Updated status of sub-issue "${subIssueTitle}" to "${repository.projectV2.statusField.name}".`);
    }));
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(failure);
      }
      throw new AggregateError(failures);
    }
  } catch (error) {
    await commentError(github, env, { owner, repo, issueNumber, actor: context.actor, error });
    throw new Error(undefined, { cause: error });
  }
}

/**
 * @param {GitHub} github
 * @param {Record<string, string>} env
 * @param {Object} parameters
 * @param {string} parameters.owner
 * @param {string} parameters.repo
 * @param {number} parameters.issueNumber
 * @param {string} parameters.actor
 * @param {unknown} parameters.error
 */
async function commentError(github, env, { owner, repo, issueNumber, actor, error }) {
  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: [
      `@${actor}`,
      `[${env.GITHUB_WORKFLOW}](${getWorkflowRunURL(env)}) failed to create subtask issues.`,
      '',
      '<details><summary>Backtrace</summary>',
      '',
      tripleBackquote(getDetailedErrorMessage(error).trimEnd()),
      '',
      '</details>',
    ].join('\n'),
  });
}

/**
 * @typedef {{
 *     id: string;
 *     number: number;
 *     title: string;
 *     body: string;
 * }} Issue
 * @typedef {{
 *   id: string;
 *   name: string;
 * }} Label
 * @typedef {{
 *   id: string;
 *   number: number;
 *   title: string;
 *   statusField: StatusField;
 * }} Project
 * @typedef {{
 *   id: string;
 *   name: string;
 *   options: {
 *     id: string;
 *   }[];
 * }} StatusField
 * @typedef {{
 *   id: string;
 *   issue: Issue;
 *   caseEntryLabel: Label;
 *   projectV2: Project;
 * }} Repository
 *
 * @param {GitHub} github
 * @param {Object} parameters
 * @param {string} parameters.owner
 * @param {string} parameters.repo
 * @param {number} parameters.issueNumber
 * @param {number} parameters.projectNumber
 * @returns {Promise<Repository>}
 */
async function getRepository(github, { owner, repo, issueNumber, projectNumber }) {
  const response = await github.graphql({
    query: `
query($owner: String!, $repo: String!, $issueNumber: Int!, $projectNumber: Int!) {
  repository(owner: $owner, name: $repo) {
    id
    issue(number: $issueNumber) {
      id
      number
      title
      body
    }
    caseEntryLabel: label(name: "案件エントリー") {
      id
      name
    }
    projectV2(number: $projectNumber) {
      id
      number
      title
      statusField: field(name: "Status") {
        ... on ProjectV2SingleSelectField {
          id
          name
          options(names: ["Task"]) {
            id
            name
          }
        }
      }
    }
  }
}
    `,
    owner,
    repo,
    issueNumber,
    projectNumber,
  });
  return response.repository;
};

/**
 * @param {GitHub} github
 * @param {Object} parameters
 * @param {string} parameters.owner
 * @param {string} parameters.repo
 * @param {number} parameters.projectNumber
 * @param {string} [cursor]
 * @param {Issue[]} issues
 * @returns {Promise<Issue[]>}
 */
async function getIssuesInProject(github, { owner, repo, projectNumber }, cursor, issues = []) {
  const response = await github.graphql({
    query: `
query($owner: String!, $repo: String!, $projectNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    projectV2(number: $projectNumber) {
      items(first: 100, after: $cursor) {
        pageInfo {
          endCursor
          hasNextPage
        }
        nodes {
          content {
            ... on Issue {
              id
              number
              title
              body
            }
          }
        }
      }
    }
  }
}
    `,
    owner,
    repo,
    projectNumber,
    cursor,
  });
  const { pageInfo, nodes } = response.repository.projectV2.items;
  const newIssues = issues.concat(nodes.map(node => node.content));
  if (pageInfo.hasNextPage) {
    return getIssuesInProject(github, { owner, repo, projectNumber }, pageInfo.endCursor, newIssues);
  }
  return newIssues;
}

/**
 * @param {GitHub} github
 * @param {Object} parameters
 * @param {string} parameters.repositoryId
 * @param {string} parameters.title
 * @param {string} [parameters.body]
 * @param {string[]} [parameters.labelIds]
 * @param {string[]} [parameters.projectIds]
 * @param {string} [parameters.parentIssueId]
 * @returns {Promise<Issue>}
 */
async function createIssue(github, { repositoryId, title, body, labelIds, parentIssueId }) {
  const response = await github.graphql({
    query: `
mutation($input: CreateIssueInput!) {
  createIssue(input: $input) {
    issue {
      id
      number
      title
      body
    }
  }
}
    `,
    input: {
      repositoryId,
      title,
      body,
      labelIds,
      parentIssueId,
    },
  });
  return response.createIssue.issue;
}

/**
 * @typedef {{ id: string; }} ProjectItem
 *
 * @param {GitHub} github
 * @param {Object} parameters
 * @param {string} parameters.projectId
 * @param {string} parameters.issueId
 * @returns {Promise<ProjectItem>}
 */
async function addIssueToProject(github, { projectId, issueId }) {
  const response = await github.graphql({
    query: `
mutation($input: AddProjectV2ItemByIdInput!) {
  addProjectV2ItemById(input: $input) {
    item {
      id
    }
  }
}
    `,
    input: {
      projectId,
      contentId: issueId,
    }
  });
  return response.addProjectV2ItemById.item;
}

/**
 * @typedef {{
 *   text?: string;
 *   number?: number;
 *   date?: Date;
 *   singleSelectOptionId?: string;
 *   iterationId?: string;
 * }} ProjectFieldValue
 *
 * @param {GitHub} github
 * @param {Object} parameters
 * @param {string} parameters.projectId
 * @param {string} parameters.itemId
 * @param {string} parameters.fieldId
 * @param {ProjectFieldValue} parameters.value
 * @returns {Promise<void>}
 */
async function updateProjectItemFieldValue(github, { projectId, itemId, fieldId, value }) {
  await github.graphql({
    query: `
mutation($input: UpdateProjectV2ItemFieldValueInput!) {
  updateProjectV2ItemFieldValue(input: $input) {
    clientMutationId
  }
}
    `,
    input: {
      projectId,
      itemId,
      fieldId,
      value,
    }
  });
}

/**
 * @param {Context} context
 * @param {Record<string, string>} env
 * @returns {{ owner: string; repo: string; }}
 */
function getOwnerAndRepo(context, env) {
  const repository = context.payload.repository;
  /** @type {string | undefined} */
  let owner;
  /** @type {string | undefined} */
  let repo;
  if (repository) {
    owner = repository.owner.login;
    repo = repository.name;
  } else {
    // Fall back to the environment variable because `workflow_dispatch` event does not provide `repository` in context.
    [owner, repo] = env['GITHUB_REPOSITORY']?.split('/', 2) ?? [,];
  }
  if (!owner || !repo) {
    throw new Error('Repository is not available');
  }
  return { owner, repo };
}

/**
 * @param {Record<string, string>} env
 * @param {string} name
 * @returns {number}
 */
function getIntegerFromEnv(env, name) {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  const number = parseInt(value, 10);
  if (isNaN(number)) {
    throw new Error(`${name} is not a valid integer.`);
  }
  return number;
}

/**
 * @param {Record<string, string>} env
 * @returns {string}
 */
function getWorkflowRunURL(env) {
  return [
    env.GITHUB_SERVER_URL,
    env.GITHUB_REPOSITORY,
    'actions/runs',
    env.GITHUB_RUN_ID,
  ].join('/');
}

/**
 * @typedef {{
 *   checked: boolean;
 *   titlePrefix: string;
 * }} Subtask
 *
 * @param {string} body
 * @returns {Subtask[]}
 */
function parseSubtasks(body) {
  const lines = body.split('\n');
  /** @type {Subtask[]} */
  const subtasks = [];
  let inSubtasks = false;
  for (const line of lines) {
    if (line.match(/<!--\s*begin subtasks\s*-->/)) {
      inSubtasks = true;
    }
    if (inSubtasks) {
      const match = line.match(/- \[([ x])\] (.*)/);
      if (match) {
        const [, status, titlePrefix] = match;
        const checked = (status === 'x');
        subtasks.push({ checked, titlePrefix });
      }
    }
    if (line.match(/<!--\s*end subtasks\s*-->/)) {
      inSubtasks = false;
    }
  }
  return subtasks;
}

/**
 * @param {string} titlePrefix
 * @param {string} parentIssueTitle
 * @returns {string}
 */
function buildSubIssueTitle(titlePrefix, parentIssueTitle) {
  return `[${titlePrefix}] ${parentIssueTitle}`;
}

/**
 * @param {string} string
 * @returns {string}
 */
function tripleBackquote(string) {
  return ['```', string, '```'].join('\n');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getDetailedErrorMessage(error) {
  if (error instanceof AggregateError) {
    return error.errors.map(getDetailedErrorMessage).join('\n');
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

module.exports = {
  main,
  commentError,
  getRepository,
  getIssuesInProject,
  createIssue,
  addIssueToProject,
  updateProjectItemFieldValue,
  getOwnerAndRepo,
  getIntegerFromEnv,
  getWorkflowRunURL,
  parseSubtasks,
  buildSubIssueTitle,
  tripleBackquote,
  getDetailedErrorMessage,
};
