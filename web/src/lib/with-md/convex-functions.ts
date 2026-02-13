export const WITH_MD_CONVEX_FUNCTIONS = {
  queries: {
    reposList: 'repos:list',
    reposGet: 'repos:get',
    mdFilesListByRepo: 'mdFiles:listByRepo',
    mdFilesGet: 'mdFiles:get',
    mdFilesResolveByPath: 'mdFiles:resolveByPath',
    commentsListByFile: 'comments:listByFile',
    suggestionsListByFile: 'suggestions:listByFile',
    activitiesListByRepo: 'activities:listByRepo',
    pushQueueUnpushedCount: 'pushQueue:unpushedCount'
  },
  mutations: {
    commentsCreate: 'comments:create',
    commentsUpdate: 'comments:update',
    commentsResolve: 'comments:resolve',
    commentsDelete: 'comments:remove',
    mdFilesSaveSource: 'mdFiles:saveSource',
    suggestionsCreate: 'suggestions:create',
    suggestionsAccept: 'suggestions:accept',
    suggestionsReject: 'suggestions:reject',
    reposResync: 'repos:resync',
    reposEnsureSeedData: 'repos:ensureSeedData',
    pushQueuePushNow: 'pushQueue:pushNow',
    activitiesMarkAsRead: 'activities:markAsRead'
  }
} as const;
