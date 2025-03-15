// @ts-check

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { getOctokit } = require('@actions/github');
const {
  // main,
  commentError,
  getRepository,
  getIssuesInProject,
  // createIssue,
  // updateProjectItemFieldValue,
  getOwnerAndRepo,
  getIntegerFromEnv,
  parseSubtasks,
  buildSubIssueTitle,
  tripleBackquote,
  getDetailedErrorMessage,
  getWorkflowRunURL,
} = require('./index.js');

const githubToken = process.env.GITHUB_TOKEN;

describe(commentError.name, () => {
  it('comments an error', async (t) => {
    const createComment = t.mock.fn();
    const github = {
      rest: {
        issues: {
          createComment,
        },
      },
    };
    const env = {
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'manicmaniac/sandbox',
      GITHUB_RUN_ID: '1',
      GITHUB_WORKFLOW: 'workflow',
    };
    const owner = 'manicmaniac';
    const repo = 'sandbox';
    const issueNumber = 1;
    const actor = 'manicmaniac';
    const error = new Error('foo');
    // @ts-ignore
    await commentError(github, env, { owner, repo, issueNumber, actor, error });
    assert.equal(createComment.mock.callCount(), 1);
    const args = createComment.mock.calls[0].arguments[0];
    assert.equal(args.owner, 'manicmaniac');
    assert.equal(args.repo, 'sandbox');
    assert.equal(args.issue_number, 1);
    assert(args.body.length > 1);
  });
});

describe(getRepository.name, () => {
  it('returns a repository', { skip: !githubToken }, async () => {
    assert(githubToken);
    const github = getOctokit(githubToken);
    const repository = await getRepository(github, {
      owner: 'manicmaniac',
      repo: 'sandbox',
      issueNumber: 1,
      projectNumber: 1,
    });
    assert(repository);
  });
});

describe(getIssuesInProject.name, () => {
  it('returns issues in a project', { skip: !githubToken }, async () => {
    assert(githubToken);
    const github = getOctokit(githubToken);
    const issues = await getIssuesInProject(github, {
      owner: 'manicmaniac',
      repo: 'sandbox',
      projectNumber: 1,
    });
    assert(issues);
  });
});

describe(getOwnerAndRepo.name, () => {
  it('returns owner and repo for labeled event', () => {
    const context = {
      payload: {
        repository: {
          owner: {
            login: 'manicmaniac',
          },
          name: 'sandbox',
        },
      },
    };
    const env = {
      GITHUB_REPOSITORY: 'manicmaniac/sandbox',
    };
    // @ts-ignore
    const ownerAndRepo = getOwnerAndRepo(context, env);
    assert.deepEqual(ownerAndRepo, { owner: 'manicmaniac', repo: 'sandbox' });
  });

  it('returns owner and repo for workflow_dispatch event', () => {
    const context = {
      payload: {},
    };
    const env = {
      GITHUB_REPOSITORY: 'manicmaniac/sandbox',
      INPUT_OWNER: 'manicmaniac',
      INPUT_REPO: 'sandbox',
    };
    // @ts-ignore
    const ownerAndRepo = getOwnerAndRepo(context, env);
    assert.deepEqual(ownerAndRepo, { owner: 'manicmaniac', repo: 'sandbox' });
  });
});

describe(getIntegerFromEnv.name, () => {
  it('returns an integer', () => {
    const env = {
      INPUT_NUMBER: '1',
    };
    const number = getIntegerFromEnv(env, 'INPUT_NUMBER');
    assert.equal(number, 1);
  });

  it('throws an error if it fails to parse the value as an integer', () => {
    const env = {
      INPUT_NUMBER: 'a',
    };
    assert.throws(() => getIntegerFromEnv(env, 'INPUT_NUMBER'));
  });
});

describe(getWorkflowRunURL.name, () => {
  it('returns a workflow run URL', () => {
    const env = {
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'manicmaniac/sandbox',
      GITHUB_RUN_ID: '1',
    };
    const url = getWorkflowRunURL(env);
    assert.equal(url, 'https://github.com/manicmaniac/sandbox/actions/runs/1');
  });
});

describe(parseSubtasks.name, () => {
  it('returns subtasks', () => {
    const body = `\
<!-- begin subtasks -->
- [x] Subtask 1
- [ ] Subtask 2
<!-- end subtasks -->
`;
    const subtasks = parseSubtasks(body);
    assert.deepEqual(subtasks, [
      { checked: true, titlePrefix: 'Subtask 1' },
      { checked: false, titlePrefix: 'Subtask 2' },
    ]);
  });
});

describe(buildSubIssueTitle.name, () => {
  it('returns a sub issue title', () => {
    const titlePrefix = 'Subtask';
    const parentIssueTitle = 'Parent Issue';
    const subIssueTitle = buildSubIssueTitle(titlePrefix, parentIssueTitle);
    assert.strictEqual(subIssueTitle, '[Subtask] Parent Issue');
  });
});

describe(tripleBackquote.name, () => {
  it('returns a string wrapped in triple backquotes', () => {
    const string = 'string';
    const wrapped = tripleBackquote(string);
    assert.strictEqual(wrapped, '```\nstring\n```');
  });
});

describe(getDetailedErrorMessage.name, () => {
  it('returns a detailed error message of an Error object', () => {
    const error = new Error('foo');
    const detailedErrorMessage = getDetailedErrorMessage(error);
    assert.match(detailedErrorMessage, /^Error: foo/);
  });

  it('returns a detailed error message of an AggregateError object', () => {
    const error = new AggregateError([
      new Error('foo'),
      new Error('bar'),
    ]);
    const detailedErrorMessage = getDetailedErrorMessage(error);
    assert.match(detailedErrorMessage, /^Error: foo.*\nError: bar/s);
  });
});
